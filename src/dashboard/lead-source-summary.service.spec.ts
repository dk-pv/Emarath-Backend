import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSourceSummaryQueryDto } from './dto/lead-source-summary-query.dto';
import {
  LeadSourceSummary,
  LeadSourceSummaryService,
  MAX_DAY_COLUMNS,
} from './lead-source-summary.service';

/**
 * The suite runs in the process timezone, so the fixtures are built from real local
 * midnights rather than hard-coded UTC strings — exactly what the client sends
 * (ADR-0028 §3). `at(day, hour)` places a record inside a known column.
 */
const TODAY = new Date(2026, 8, 10); // 10 Sep 2026, local
const MONTH_START = new Date(2026, 8, 1);
const MONTH_END = new Date(2026, 9, 1);
const DAY_MS = 86_400_000;

const at = (dayOfMonth: number, hour = 9): Date =>
  new Date(2026, 8, dayOfMonth, hour);

type LeadRow = { id: string; createdAt: Date; source: string | null };
type AssignmentRow = {
  leadId: string;
  createdAt: Date;
  lead: { source: string | null };
};

/**
 * The calls are recorded into typed arrays rather than read back off a
 * `jest.fn()`, whose `mock.calls` are `any` — the standards forbid that, and a
 * scoping assertion that silently degrades to `any` is exactly the one that stops
 * catching a regression.
 */
function makeService(
  data: { leads?: LeadRow[]; assignments?: AssignmentRow[] } = {},
  role: UserRole = UserRole.SUPERADMIN,
) {
  const leadCalls: { where: Prisma.LeadWhereInput }[] = [];
  const assignmentCalls: { where: Prisma.LeadAssignmentWhereInput }[] = [];
  const prisma = {
    lead: {
      findMany: (args: { where: Prisma.LeadWhereInput }) => {
        leadCalls.push(args);
        return Promise.resolve(data.leads ?? []);
      },
    },
    leadAssignment: {
      findMany: (args: { where: Prisma.LeadAssignmentWhereInput }) => {
        assignmentCalls.push(args);
        return Promise.resolve(data.assignments ?? []);
      },
    },
  } as unknown as PrismaService;
  // No assertion needed: a plain object with `resolve` already satisfies the
  // service structurally, now that the stub is a real function rather than an
  // `any`-typed `jest.fn()`.
  const currentUser: Pick<CurrentUserService, 'resolve'> = {
    resolve: () => Promise.resolve({ id: 'u1', role }),
  };
  return {
    service: new LeadSourceSummaryService(prisma, currentUser),
    leadCalls,
    assignmentCalls,
  };
}

const query = (over: Partial<LeadSourceSummaryQueryDto> = {}) =>
  ({
    mode: 'created',
    todayStart: TODAY.toISOString(),
    from: MONTH_START.toISOString(),
    to: MONTH_END.toISOString(),
    ...over,
  }) as LeadSourceSummaryQueryDto;

/** The column index for a day of September in the fixture month. */
const col = (dayOfMonth: number) => dayOfMonth - 1;

const rowFor = (result: LeadSourceSummary, source: string) => {
  const row = result.sources.find((entry) => entry.source === source);
  if (!row) throw new Error(`no row for ${source}`);
  return row;
};

describe('LeadSourceSummaryService', () => {
  describe('created-date aggregation', () => {
    it('buckets leads into one column per local day of the period', async () => {
      const { service } = makeService({
        leads: [
          { id: 'a', createdAt: at(3), source: 'DoubleTick' },
          { id: 'b', createdAt: at(3, 23), source: 'DoubleTick' },
          { id: 'c', createdAt: at(5), source: 'DoubleTick' },
        ],
      });

      const result = await service.getSummary(query());

      expect(result.dates).toHaveLength(30); // September
      const row = rowFor(result, 'DoubleTick');
      expect(row.values[col(3)]).toBe(2);
      expect(row.values[col(5)]).toBe(1);
      expect(row.values[col(4)]).toBe(0);
      expect(row.total).toBe(3);
    });

    it('reads Lead.createdAt, not the assignment table', async () => {
      const { service, leadCalls, assignmentCalls } = makeService({
        leads: [{ id: 'a', createdAt: at(2), source: 'Direct' }],
      });

      await service.getSummary(query({ mode: 'created' }));

      expect(leadCalls).toHaveLength(1);
      expect(assignmentCalls).toHaveLength(0);
    });

    it('keeps every day of a bounded period as a column, data or not', async () => {
      const { service } = makeService({ leads: [] });

      const result = await service.getSummary(query());

      expect(result.dates).toHaveLength(30);
      expect(result.dailyTotals).toHaveLength(30);
      expect(result.dailyTotals.every((total) => total === 0)).toBe(true);
    });
  });

  describe('assigned-date aggregation', () => {
    it('reads LeadAssignment.createdAt, not the lead creation date', async () => {
      const { service, leadCalls, assignmentCalls } = makeService({
        assignments: [
          { leadId: 'a', createdAt: at(7), lead: { source: 'Broadcast' } },
        ],
      });

      const result = await service.getSummary(query({ mode: 'assigned' }));

      expect(assignmentCalls).toHaveLength(1);
      expect(leadCalls).toHaveLength(0);
      expect(rowFor(result, 'Broadcast').values[col(7)]).toBe(1);
    });

    it('counts a co-assigned lead once per day, not once per assignee', async () => {
      const { service } = makeService({
        assignments: [
          { leadId: 'a', createdAt: at(4, 9), lead: { source: 'Reorder' } },
          { leadId: 'a', createdAt: at(4, 11), lead: { source: 'Reorder' } },
          { leadId: 'a', createdAt: at(4, 16), lead: { source: 'Reorder' } },
          { leadId: 'b', createdAt: at(4, 10), lead: { source: 'Reorder' } },
        ],
      });

      const result = await service.getSummary(query({ mode: 'assigned' }));

      expect(rowFor(result, 'Reorder').values[col(4)]).toBe(2);
      expect(result.grandTotal).toBe(2);
    });

    it('counts a lead again when it is reassigned on a later day', async () => {
      const { service } = makeService({
        assignments: [
          { leadId: 'a', createdAt: at(4), lead: { source: 'Reorder' } },
          { leadId: 'a', createdAt: at(9), lead: { source: 'Reorder' } },
        ],
      });

      const result = await service.getSummary(query({ mode: 'assigned' }));

      const row = rowFor(result, 'Reorder');
      expect(row.values[col(4)]).toBe(1);
      expect(row.values[col(9)]).toBe(1);
      expect(row.total).toBe(2);
    });

    it('produces different figures from created mode on the same window', async () => {
      const leads: LeadRow[] = [
        { id: 'a', createdAt: at(2), source: 'DoubleTick' },
        { id: 'b', createdAt: at(2), source: 'DoubleTick' },
      ];
      const assignments: AssignmentRow[] = [
        { leadId: 'a', createdAt: at(8), lead: { source: 'DoubleTick' } },
      ];
      const { service } = makeService({ leads, assignments });

      const created = await service.getSummary(query({ mode: 'created' }));
      const assigned = await service.getSummary(query({ mode: 'assigned' }));

      expect(created.grandTotal).toBe(2);
      expect(assigned.grandTotal).toBe(1);
      expect(rowFor(created, 'DoubleTick').values[col(2)]).toBe(2);
      expect(rowFor(assigned, 'DoubleTick').values[col(8)]).toBe(1);
    });
  });

  describe('source grouping', () => {
    it('returns only the sources present in the data, alphabetically', async () => {
      const { service } = makeService({
        leads: [
          { id: 'a', createdAt: at(1), source: 'Website' },
          { id: 'b', createdAt: at(1), source: 'Broadcast' },
          { id: 'c', createdAt: at(1), source: 'direct' },
        ],
      });

      const result = await service.getSummary(query());

      expect(result.sources.map((row) => row.source)).toEqual([
        'Broadcast',
        'direct',
        'Website',
      ]);
    });

    it('folds null and blank sources into one "No Source" bucket, listed last', async () => {
      const { service } = makeService({
        leads: [
          { id: 'a', createdAt: at(1), source: null },
          { id: 'b', createdAt: at(1), source: '   ' },
          { id: 'c', createdAt: at(1), source: '' },
          { id: 'd', createdAt: at(1), source: 'Website' },
        ],
      });

      const result = await service.getSummary(query());

      expect(result.sources.map((row) => row.source)).toEqual([
        'Website',
        'No Source',
      ]);
      expect(rowFor(result, 'No Source').total).toBe(3);
    });
  });

  describe('reconciliation', () => {
    const spread = {
      leads: [
        { id: 'a', createdAt: at(1), source: 'DoubleTick' },
        { id: 'b', createdAt: at(1), source: 'DoubleTick' },
        { id: 'c', createdAt: at(2), source: 'Broadcast' },
        { id: 'd', createdAt: at(9), source: null },
        { id: 'e', createdAt: at(9), source: 'DoubleTick' },
      ] satisfies LeadRow[],
    };

    it('sums every source row to the grand total', async () => {
      const { service } = makeService(spread);
      const result = await service.getSummary(query());

      const fromRows = result.sources.reduce((sum, row) => sum + row.total, 0);
      expect(fromRows).toBe(result.grandTotal);
      expect(result.grandTotal).toBe(5);
    });

    it('sums every cell to the grand total', async () => {
      const { service } = makeService(spread);
      const result = await service.getSummary(query());

      const fromCells = result.sources
        .flatMap((row) => row.values)
        .reduce((sum, value) => sum + value, 0);
      expect(fromCells).toBe(result.grandTotal);
    });

    it('makes each Total-row cell the column sum of the source rows', async () => {
      const { service } = makeService(spread);
      const result = await service.getSummary(query());

      result.dailyTotals.forEach((total, index) => {
        const column = result.sources.reduce(
          (sum, row) => sum + row.values[index],
          0,
        );
        expect(total).toBe(column);
      });
      expect(result.dailyTotals[col(1)]).toBe(2);
      expect(result.dailyTotals[col(9)]).toBe(2);
    });

    it('gives every source row exactly one value per column', async () => {
      const { service } = makeService(spread);
      const result = await service.getSummary(query());

      for (const row of result.sources) {
        expect(row.values).toHaveLength(result.dates.length);
      }
      expect(result.dailyTotals).toHaveLength(result.dates.length);
    });
  });

  describe('role scoping', () => {
    it('scopes a sales agent to their own leads in created mode', async () => {
      const { service, leadCalls } = makeService(
        { leads: [] },
        UserRole.SALES_AGENT,
      );

      await service.getSummary(query({ mode: 'created' }));

      expect(leadCalls[0].where.assignments).toEqual({
        some: { userId: 'u1' },
      });
      expect(leadCalls[0].where.deletedAt).toBeNull();
    });

    it('scopes a sales agent through the lead relation in assigned mode', async () => {
      const { service, assignmentCalls } = makeService(
        { assignments: [] },
        UserRole.SALES_AGENT,
      );

      await service.getSummary(query({ mode: 'assigned' }));

      expect(assignmentCalls[0].where.lead).toEqual({
        deletedAt: null,
        assignments: { some: { userId: 'u1' } },
      });
    });

    it('does not narrow an admin to their own leads', async () => {
      const { service, leadCalls } = makeService(
        { leads: [] },
        UserRole.SUPERADMIN,
      );

      await service.getSummary(query());

      expect(leadCalls[0].where.assignments).toBeUndefined();
    });
  });

  describe('the period', () => {
    it('applies the window to the query it reads', async () => {
      const { service, leadCalls } = makeService({ leads: [] });

      await service.getSummary(query());

      // Compared whole rather than reaching into the filter: `createdAt` is a
      // union on `LeadWhereInput`, and narrowing it would need the cast the
      // standards forbid.
      expect(leadCalls[0].where.createdAt).toEqual({
        gte: MONTH_START,
        lt: MONTH_END,
      });
    });

    it('changes the columns when the period changes', async () => {
      const { service } = makeService({ leads: [] });

      const week = await service.getSummary(
        query({
          from: new Date(2026, 8, 7).toISOString(),
          to: new Date(2026, 8, 14).toISOString(),
        }),
      );

      expect(week.dates).toHaveLength(7);
    });

    it('adds no date predicate for the All preset', async () => {
      const { service, leadCalls } = makeService({
        leads: [{ id: 'a', createdAt: at(3), source: 'Direct' }],
      });

      await service.getSummary(query({ from: undefined, to: undefined }));

      expect(leadCalls[0].where.createdAt).toBeUndefined();
    });

    it('spans the data itself when the period carries no bounds', async () => {
      const { service } = makeService({
        leads: [
          { id: 'a', createdAt: at(3), source: 'Direct' },
          { id: 'b', createdAt: at(6), source: 'Direct' },
        ],
      });

      const result = await service.getSummary(
        query({ from: undefined, to: undefined }),
      );

      expect(result.dates).toHaveLength(4); // Sep 3 … Sep 6
      expect(result.grandTotal).toBe(2);
    });

    it('caps an unbounded span at MAX_DAY_COLUMNS, keeping the most recent days', async () => {
      const oldest = new Date(TODAY.getTime() - 400 * DAY_MS);
      const { service } = makeService({
        leads: [
          { id: 'old', createdAt: oldest, source: 'Direct' },
          { id: 'new', createdAt: TODAY, source: 'Direct' },
        ],
      });

      const result = await service.getSummary(
        query({ from: undefined, to: undefined }),
      );

      expect(result.dates).toHaveLength(MAX_DAY_COLUMNS);
      // The oldest lead falls outside the kept window and is not counted.
      expect(result.grandTotal).toBe(1);
    });
  });

  describe('empty results', () => {
    it('returns no source rows and a zero grand total', async () => {
      const { service } = makeService({ leads: [] });

      const result = await service.getSummary(query());

      expect(result.sources).toEqual([]);
      expect(result.grandTotal).toBe(0);
    });

    it('still returns a single column when unbounded and empty', async () => {
      const { service } = makeService({ leads: [] });

      const result = await service.getSummary(
        query({ from: undefined, to: undefined }),
      );

      expect(result.dates).toHaveLength(1);
      expect(result.grandTotal).toBe(0);
    });
  });
});
