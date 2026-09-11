import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsConversionQueryDto } from './dto/leads-conversion-query.dto';
import {
  LeadsConversionService,
  UNASSIGNED_LABEL,
} from './leads-conversion.service';

type SourceGroup = { source: string | null; _count: { _all: number } };
type UserGroup = { userId: string; _count: { _all: number } };

type Fixture = {
  /** `lead.groupBy` results, in call order: all, then converted. */
  sourceGroups?: [SourceGroup[], SourceGroup[]];
  /** `leadAssignment.groupBy` results, in call order: all, then converted. */
  userGroups?: [UserGroup[], UserGroup[]];
  users?: { id: string; name: string }[];
  /**
   * `lead.count` results keyed by what is being counted, not by call order —
   * `Promise.all` fixes the order of *creation*, which is easy to get wrong in a
   * fixture and would silently swap two numbers. `leads`/`won` are the distinct
   * totals; `unassignedLeads`/`unassignedWon` the no-assignee bucket.
   */
  counts?: Partial<
    Record<'leads' | 'won' | 'unassignedLeads' | 'unassignedWon', number>
  >;
};

/**
 * Calls are recorded into typed arrays rather than read off `jest.fn()`, whose
 * `mock.calls` are `any` — the standards forbid that, and a scoping assertion that
 * degrades to `any` is the one that stops catching a regression.
 */
function makeService(
  fixture: Fixture = {},
  role: UserRole = UserRole.SUPERADMIN,
) {
  const sourceGroupArgs: { where: Prisma.LeadWhereInput }[] = [];
  const userGroupArgs: { where: { lead: Prisma.LeadWhereInput } }[] = [];
  const countArgs: { where: Prisma.LeadWhereInput }[] = [];
  const sources = fixture.sourceGroups ?? [[], []];
  const assignees = fixture.userGroups ?? [[], []];
  const counts = fixture.counts ?? {};

  const prisma = {
    lead: {
      groupBy: (args: { where: Prisma.LeadWhereInput }) => {
        sourceGroupArgs.push(args);
        return Promise.resolve(sources[sourceGroupArgs.length - 1] ?? []);
      },
      count: (args: { where: Prisma.LeadWhereInput }) => {
        countArgs.push(args);
        const shape = JSON.stringify(args.where);
        const unassigned = shape.includes('"none"');
        const won = shape.includes('WON');
        const key = unassigned
          ? won
            ? 'unassignedWon'
            : 'unassignedLeads'
          : won
            ? 'won'
            : 'leads';
        return Promise.resolve(counts[key] ?? 0);
      },
    },
    leadAssignment: {
      groupBy: (args: { where: { lead: Prisma.LeadWhereInput } }) => {
        userGroupArgs.push(args);
        return Promise.resolve(assignees[userGroupArgs.length - 1] ?? []);
      },
    },
    user: {
      findMany: () => Promise.resolve(fixture.users ?? []),
    },
  } as unknown as PrismaService;

  const currentUser: Pick<CurrentUserService, 'resolve'> = {
    resolve: () => Promise.resolve({ id: 'u1', role }),
  };

  return {
    service: new LeadsConversionService(prisma, currentUser),
    sourceGroupArgs,
    userGroupArgs,
    countArgs,
  };
}

const FROM = new Date(2026, 8, 1).toISOString();
const TO = new Date(2026, 9, 1).toISOString();

const query = (over: Partial<LeadsConversionQueryDto> = {}) =>
  ({
    breakdown: 'source',
    from: FROM,
    to: TO,
    ...over,
  }) as LeadsConversionQueryDto;

const src = (source: string | null, n: number): SourceGroup => ({
  source,
  _count: { _all: n },
});
const usr = (userId: string, n: number): UserGroup => ({
  userId,
  _count: { _all: n },
});

describe('LeadsConversionService', () => {
  describe('source breakdown', () => {
    it('returns a lead count and a converted count per source', async () => {
      const { service } = makeService({
        sourceGroups: [
          [src('Broadcast', 10), src('Direct', 4)],
          [src('Broadcast', 3), src('Direct', 1)],
        ],
        counts: { leads: 14, won: 4 },
      });

      const { rows } = await service.getLeadsConversion(query());

      expect(rows).toEqual([
        { category: 'Broadcast', leadCount: 10, convertedCount: 3 },
        { category: 'Direct', leadCount: 4, convertedCount: 1 },
      ]);
    });

    it('orders alphabetically with No Source last', async () => {
      const { service } = makeService({
        sourceGroups: [
          [src(null, 2), src('Website', 1), src('Broadcast', 1)],
          [],
        ],
        counts: { leads: 4, won: 0 },
      });

      const { rows } = await service.getLeadsConversion(query());

      expect(rows.map((row) => row.category)).toEqual([
        'Broadcast',
        'Website',
        'No Source',
      ]);
    });

    it('folds null and blank sources into one No Source bucket', async () => {
      const { service } = makeService({
        sourceGroups: [[src(null, 2), src('   ', 1), src('', 3)], []],
        counts: { leads: 6, won: 0 },
      });

      const { rows } = await service.getLeadsConversion(query());

      expect(rows).toEqual([
        { category: 'No Source', leadCount: 6, convertedCount: 0 },
      ]);
    });

    it('reports zero conversions for a source that has none', async () => {
      const { service } = makeService({
        sourceGroups: [[src('Broadcast', 5)], [src('Direct', 2)]],
        counts: { leads: 5, won: 0 },
      });

      const { rows } = await service.getLeadsConversion(query());

      expect(rows).toEqual([
        { category: 'Broadcast', leadCount: 5, convertedCount: 0 },
      ]);
    });

    it('reconciles: the rows sum to the distinct totals', async () => {
      const { service } = makeService({
        sourceGroups: [
          [src('Broadcast', 10), src('Direct', 4), src(null, 6)],
          [src('Broadcast', 3), src('Direct', 1), src(null, 2)],
        ],
        counts: { leads: 20, won: 6 },
      });

      const { rows, totals } = await service.getLeadsConversion(query());

      const leads = rows.reduce((sum, row) => sum + row.leadCount, 0);
      const won = rows.reduce((sum, row) => sum + row.convertedCount, 0);
      expect(leads).toBe(totals.leadCount);
      expect(won).toBe(totals.convertedCount);
    });
  });

  describe('team breakdown', () => {
    it('returns a row per assignee, named', async () => {
      const { service } = makeService({
        userGroups: [
          [usr('a', 7), usr('b', 3)],
          [usr('a', 2), usr('b', 1)],
        ],
        users: [
          { id: 'a', name: 'Ranjith Lal' },
          { id: 'b', name: 'Neha P' },
        ],
        counts: { leads: 10, won: 3 },
      });

      const { rows } = await service.getLeadsConversion(
        query({ breakdown: 'team' }),
      );

      expect(rows).toEqual([
        { category: 'Neha P', leadCount: 3, convertedCount: 1 },
        { category: 'Ranjith Lal', leadCount: 7, convertedCount: 2 },
      ]);
    });

    it('groups through the assignment relation, not the lead source', async () => {
      const { service, sourceGroupArgs, userGroupArgs } = makeService({
        userGroups: [[usr('a', 1)], []],
        users: [{ id: 'a', name: 'Ranjith Lal' }],
        counts: { leads: 1, won: 0 },
      });

      await service.getLeadsConversion(query({ breakdown: 'team' }));

      expect(userGroupArgs).toHaveLength(2);
      expect(sourceGroupArgs).toHaveLength(0);
    });

    it('adds an Unassigned bucket so no lead is dropped', async () => {
      const { service } = makeService({
        userGroups: [[usr('a', 4)], [usr('a', 1)]],
        users: [{ id: 'a', name: 'Ranjith Lal' }],
        // lead.count order: distinct leads, distinct won, unassigned, unassigned won
        counts: { leads: 6, won: 2, unassignedLeads: 2, unassignedWon: 1 },
      });

      const { rows } = await service.getLeadsConversion(
        query({ breakdown: 'team' }),
      );

      expect(rows[rows.length - 1]).toEqual({
        category: UNASSIGNED_LABEL,
        leadCount: 2,
        convertedCount: 1,
      });
    });

    it('omits the Unassigned bucket when every lead is assigned', async () => {
      const { service } = makeService({
        userGroups: [[usr('a', 4)], []],
        users: [{ id: 'a', name: 'Ranjith Lal' }],
        counts: { leads: 4, won: 0, unassignedLeads: 0, unassignedWon: 0 },
      });

      const { rows } = await service.getLeadsConversion(
        query({ breakdown: 'team' }),
      );

      expect(rows.map((row) => row.category)).toEqual(['Ranjith Lal']);
    });

    it('reconciles: rows sum to the distinct total when nobody shares a lead', async () => {
      const { service } = makeService({
        userGroups: [
          [usr('a', 4), usr('b', 2)],
          [usr('a', 1), usr('b', 1)],
        ],
        users: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        counts: { leads: 6, won: 2, unassignedLeads: 0, unassignedWon: 0 },
      });

      const { rows, totals } = await service.getLeadsConversion(
        query({ breakdown: 'team' }),
      );

      expect(rows.reduce((s, r) => s + r.leadCount, 0)).toBe(totals.leadCount);
      expect(rows.reduce((s, r) => s + r.convertedCount, 0)).toBe(
        totals.convertedCount,
      );
    });

    it('sums past the distinct total when a lead is co-assigned, and says so', async () => {
      // Two agents, one shared lead: 2 assignment rows over 1 distinct lead.
      const { service } = makeService({
        userGroups: [[usr('a', 1), usr('b', 1)], []],
        users: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        counts: { leads: 1, won: 0, unassignedLeads: 0, unassignedWon: 0 },
      });

      const { rows, totals } = await service.getLeadsConversion(
        query({ breakdown: 'team' }),
      );

      expect(rows.reduce((s, r) => s + r.leadCount, 0)).toBe(2);
      expect(totals.leadCount).toBe(1);
    });
  });

  describe('conversion definition', () => {
    it('counts converted leads as status WON, the approved definition', async () => {
      const { service, sourceGroupArgs } = makeService({
        sourceGroups: [[], []],
        counts: { leads: 0, won: 0 },
      });

      await service.getLeadsConversion(query());

      // Second groupBy is the converted one; its where carries the status filter.
      expect(JSON.stringify(sourceGroupArgs[1].where)).toContain('WON');
      expect(JSON.stringify(sourceGroupArgs[0].where)).not.toContain('WON');
    });
  });

  describe('the period', () => {
    it('applies the window to the query it reads', async () => {
      const { service, sourceGroupArgs } = makeService({
        sourceGroups: [[], []],
        counts: { leads: 0, won: 0 },
      });

      await service.getLeadsConversion(query());

      expect(JSON.stringify(sourceGroupArgs[0].where)).toContain(
        new Date(FROM).toISOString(),
      );
    });

    it('adds no date predicate for the All preset', async () => {
      const { service, sourceGroupArgs } = makeService({
        sourceGroups: [[], []],
        counts: { leads: 0, won: 0 },
      });

      await service.getLeadsConversion(
        query({ from: undefined, to: undefined }),
      );

      expect(JSON.stringify(sourceGroupArgs[0].where)).not.toContain(
        'createdAt',
      );
    });
  });

  describe('role scoping', () => {
    it('scopes a sales agent to their own leads', async () => {
      const { service, sourceGroupArgs } = makeService(
        { sourceGroups: [[], []], counts: {} },
        UserRole.SALES_AGENT,
      );

      await service.getLeadsConversion(query());

      expect(JSON.stringify(sourceGroupArgs[0].where)).toContain('u1');
    });

    it('does not narrow an admin to their own leads', async () => {
      const { service, sourceGroupArgs } = makeService(
        { sourceGroups: [[], []], counts: {} },
        UserRole.SUPERADMIN,
      );

      await service.getLeadsConversion(query());

      expect(JSON.stringify(sourceGroupArgs[0].where)).not.toContain('u1');
    });

    it('scopes the team breakdown through the lead relation', async () => {
      const { service, userGroupArgs } = makeService(
        { userGroups: [[], []], counts: {} },
        UserRole.SALES_AGENT,
      );

      await service.getLeadsConversion(query({ breakdown: 'team' }));

      expect(userGroupArgs[0].where.lead).toBeDefined();
      expect(JSON.stringify(userGroupArgs[0].where.lead)).toContain('u1');
    });
  });

  describe('empty period', () => {
    it('returns no rows and zero totals', async () => {
      const { service } = makeService({ sourceGroups: [[], []], counts: {} });

      const { rows, totals } = await service.getLeadsConversion(query());

      expect(rows).toEqual([]);
      expect(totals).toEqual({ leadCount: 0, convertedCount: 0 });
    });
  });
});
