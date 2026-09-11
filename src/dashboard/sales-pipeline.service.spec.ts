import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { buildLeadWhere } from '../leads/lead-where';
import { DashboardPeriodQueryDto } from './dto/dashboard-period-query.dto';
import { SalesPipelineService } from './sales-pipeline.service';

type LeadGroup = {
  pipeline: string;
  status: string;
  _count: { _all: number };
};
type StageRow = { pipeline: string; name: string };

type Fixture = {
  grouped?: LeadGroup[];
  /** Returned in the order the service's `orderBy` would produce. */
  stages?: StageRow[];
  pipelines?: { name: string; shortCode: string | null }[];
  total?: number;
};

function makeService(
  fixture: Fixture = {},
  role: UserRole = UserRole.SUPERADMIN,
) {
  const groupByArgs: { where: Prisma.LeadWhereInput }[] = [];
  const stageArgs: {
    where: Prisma.StageWhereInput;
    orderBy: Prisma.StageOrderByWithRelationInput[];
  }[] = [];
  const countArgs: { where: Prisma.LeadWhereInput }[] = [];

  const prisma = {
    lead: {
      groupBy: (args: { where: Prisma.LeadWhereInput }) => {
        groupByArgs.push(args);
        return Promise.resolve(fixture.grouped ?? []);
      },
      count: (args: { where: Prisma.LeadWhereInput }) => {
        countArgs.push(args);
        return Promise.resolve(fixture.total ?? 0);
      },
    },
    stage: {
      findMany: (args: {
        where: Prisma.StageWhereInput;
        orderBy: Prisma.StageOrderByWithRelationInput[];
      }) => {
        stageArgs.push(args);
        return Promise.resolve(fixture.stages ?? []);
      },
    },
    pipeline: {
      findMany: () => Promise.resolve(fixture.pipelines ?? []),
    },
  } as unknown as PrismaService;

  const currentUser: Pick<CurrentUserService, 'resolve'> = {
    resolve: () => Promise.resolve({ id: 'u1', role }),
  };

  return {
    service: new SalesPipelineService(prisma, currentUser),
    groupByArgs,
    stageArgs,
    countArgs,
  };
}

const FROM = new Date(2026, 8, 1).toISOString();
const TO = new Date(2026, 9, 1).toISOString();
const query = (over: Partial<DashboardPeriodQueryDto> = {}) =>
  ({ from: FROM, to: TO, ...over }) as DashboardPeriodQueryDto;

const LP = 'Lead Pipeline';
const group = (pipeline: string, status: string, n: number): LeadGroup => ({
  pipeline,
  status,
  _count: { _all: n },
});

describe('SalesPipelineService', () => {
  describe('stage counts', () => {
    it('gives every included stage its lead count', async () => {
      const { service } = makeService({
        stages: [
          { pipeline: LP, name: 'New' },
          { pipeline: LP, name: 'HOT' },
        ],
        grouped: [group(LP, 'New', 12), group(LP, 'HOT', 3)],
        pipelines: [{ name: LP, shortCode: 'LP' }],
        total: 15,
      });

      const { stages, total } = await service.getOverview(query());

      expect(stages).toEqual([
        { pipeline: LP, name: 'New', label: 'New(LP)', count: 12 },
        { pipeline: LP, name: 'HOT', label: 'HOT(LP)', count: 3 },
      ]);
      expect(total).toBe(15);
    });

    it('reports a configured stage holding no leads as zero, not absent', async () => {
      const { service } = makeService({
        stages: [
          { pipeline: LP, name: 'New' },
          { pipeline: LP, name: 'Cold' },
        ],
        grouped: [group(LP, 'New', 4)],
        pipelines: [{ name: LP, shortCode: 'LP' }],
        total: 4,
      });

      const { stages } = await service.getOverview(query());

      expect(stages.map((s) => [s.name, s.count])).toEqual([
        ['New', 4],
        ['Cold', 0],
      ]);
    });

    it('never counts a stage from another pipeline into this one', async () => {
      const { service } = makeService({
        stages: [
          { pipeline: LP, name: 'Complaint' },
          { pipeline: 'Complaint Suite', name: 'Complaint' },
        ],
        grouped: [
          group(LP, 'Complaint', 2),
          group('Complaint Suite', 'Complaint', 9),
        ],
        pipelines: [
          { name: LP, shortCode: 'LP' },
          { name: 'Complaint Suite', shortCode: 'CS' },
        ],
        total: 11,
      });

      const { stages } = await service.getOverview(query());

      expect(stages).toEqual([
        { pipeline: LP, name: 'Complaint', label: 'Complaint(LP)', count: 2 },
        {
          pipeline: 'Complaint Suite',
          name: 'Complaint',
          label: 'Complaint(CS)',
          count: 9,
        },
      ]);
    });
  });

  describe('the stage catalogue', () => {
    it('asks only for stages included in the sales pipeline', async () => {
      const { service, stageArgs } = makeService();

      await service.getOverview(query());

      expect(stageArgs[0].where).toEqual({
        inclusion: 'INCLUDE_IN_SALES_PIPELINE',
      });
    });

    it('orders by configured position, breaking ties on pipeline', async () => {
      const { service, stageArgs } = makeService();

      await service.getOverview(query());

      expect(stageArgs[0].orderBy).toEqual([
        { position: 'asc' },
        { pipeline: 'asc' },
      ]);
    });

    it('labels a stage with its pipeline short code', async () => {
      const { service } = makeService({
        stages: [{ pipeline: LP, name: 'WON' }],
        pipelines: [{ name: LP, shortCode: 'LS' }],
      });

      const { stages } = await service.getOverview(query());

      expect(stages[0].label).toBe('WON(LS)');
    });

    it('falls back to the board initials when it has no short code', async () => {
      // The shipped default board has no short code, and the reference still
      // captions its stages "(LP)" — not "(Lead Pipeline)".
      const { service } = makeService({
        stages: [{ pipeline: LP, name: 'New' }],
        pipelines: [{ name: LP, shortCode: null }],
      });

      const { stages } = await service.getOverview(query());

      expect(stages[0].label).toBe('New(LP)');
    });

    it('prefers a configured short code over the initials', async () => {
      const { service } = makeService({
        stages: [{ pipeline: 'Lead Lifecycle', name: 'New Stage' }],
        pipelines: [{ name: 'Lead Lifecycle', shortCode: 'LL' }],
      });

      const { stages } = await service.getOverview(query());

      expect(stages[0].label).toBe('New Stage(LL)');
    });
  });

  describe('reconciliation with the Kanban board', () => {
    /**
     * The board composes `buildLeadWhere(user, { ...query, pipeline })` and groups by
     * `status`. This asserts the widget's own `where` is that same predicate for the
     * All preset — if the two ever diverge, a bar and its Kanban column would report
     * different numbers, which DASH-12 forbids.
     */
    it('builds the same scoped where the board does', async () => {
      const { service, groupByArgs } = makeService();

      await service.getOverview(query({ from: undefined, to: undefined }));

      const board = buildLeadWhere({ id: 'u1', role: UserRole.SUPERADMIN }, {});
      expect(groupByArgs[0].where).toEqual(board);
    });

    it('matches the board for a sales agent too', async () => {
      const { service, groupByArgs } = makeService({}, UserRole.SALES_AGENT);

      await service.getOverview(query({ from: undefined, to: undefined }));

      const board = buildLeadWhere(
        { id: 'u1', role: UserRole.SALES_AGENT },
        {},
      );
      expect(groupByArgs[0].where).toEqual(board);
    });

    it('adds only the period on top of that predicate', async () => {
      const { service, groupByArgs } = makeService();

      await service.getOverview(query());

      const board = buildLeadWhere(
        { id: 'u1', role: UserRole.SUPERADMIN },
        { createdFrom: FROM, createdTo: TO },
      );
      expect(groupByArgs[0].where).toEqual(board);
    });
  });

  describe('role scoping', () => {
    it('scopes a sales agent to their own leads', async () => {
      const { service, groupByArgs } = makeService({}, UserRole.SALES_AGENT);

      await service.getOverview(query());

      expect(JSON.stringify(groupByArgs[0].where)).toContain('u1');
    });

    it('does not narrow an admin', async () => {
      const { service, groupByArgs } = makeService({}, UserRole.SUPERADMIN);

      await service.getOverview(query());

      expect(JSON.stringify(groupByArgs[0].where)).not.toContain('u1');
    });
  });

  describe('the period', () => {
    it('applies the window to the grouping query', async () => {
      const { service, groupByArgs } = makeService();

      await service.getOverview(query());

      expect(JSON.stringify(groupByArgs[0].where)).toContain(
        new Date(FROM).toISOString(),
      );
    });

    it('adds no date predicate for the All preset', async () => {
      const { service, groupByArgs } = makeService();

      await service.getOverview(query({ from: undefined, to: undefined }));

      expect(JSON.stringify(groupByArgs[0].where)).not.toContain('createdAt');
    });
  });

  describe('empty period', () => {
    it('still lists every configured stage, all at zero', async () => {
      const { service } = makeService({
        stages: [
          { pipeline: LP, name: 'New' },
          { pipeline: LP, name: 'HOT' },
        ],
        grouped: [],
        pipelines: [{ name: LP, shortCode: 'LP' }],
        total: 0,
      });

      const { stages, total } = await service.getOverview(query());

      expect(stages.map((s) => s.count)).toEqual([0, 0]);
      expect(total).toBe(0);
    });
  });
});
