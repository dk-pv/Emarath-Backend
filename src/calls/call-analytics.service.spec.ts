import { CallOutcome, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CallAnalyticsService } from './call-analytics.service';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const FROM = '2026-07-27T00:00:00.000Z';
const TO = '2026-07-28T00:00:00.000Z';

type Lead = {
  id: string;
  source: string | null;
  status: string;
  pipeline: string;
};

function makeService(
  outcomes: { outcome: CallOutcome; _count: { _all: number } }[],
  leadGroups: { leadId: string; _count: { _all: number } }[],
  leads: Lead[],
  role: UserRole = UserRole.SUPERADMIN,
) {
  const callGroupBy = jest.fn((args: { by: string[] }) =>
    Promise.resolve(args.by[0] === 'outcome' ? outcomes : leadGroups),
  );
  const leadFindMany = jest.fn().mockResolvedValue(leads);
  const prisma = {
    call: { groupBy: callGroupBy },
    lead: { findMany: leadFindMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: USER_ID, role }),
  } as unknown as CurrentUserService;
  return {
    service: new CallAnalyticsService(prisma, currentUser),
    callGroupBy,
  };
}

const query = { from: FROM, to: TO };

describe('CallAnalyticsService.getAnalytics', () => {
  it('lists all six Workpex dispositions, holding the three the PBX does not report at zero', async () => {
    const { service } = makeService(
      [
        { outcome: CallOutcome.ANSWERED, _count: { _all: 43 } },
        { outcome: CallOutcome.NO_ANSWER, _count: { _all: 65 } },
      ],
      [],
      [],
    );
    const { byStatus } = await service.getAnalytics(query);
    expect(byStatus.map((row) => row.label)).toEqual([
      'ANSWERED',
      'BUSY',
      'NO ANSWER',
      'CONGESTION',
      'CHAN UN AVAIL',
      'CANCEL',
    ]);
    expect(byStatus).toContainEqual({ label: 'ANSWERED', count: 43 });
    expect(byStatus).toContainEqual({ label: 'NO ANSWER', count: 65 });
    // Reported by no ingested call — zero, never invented.
    expect(byStatus).toContainEqual({ label: 'CONGESTION', count: 0 });
    expect(byStatus).toContainEqual({ label: 'BUSY', count: 0 });
  });

  it('folds calls by the lead source and totals to the donut centre', async () => {
    const { service } = makeService(
      [],
      [
        { leadId: 'a', _count: { _all: 5 } },
        { leadId: 'b', _count: { _all: 3 } },
        { leadId: 'c', _count: { _all: 2 } },
      ],
      [
        {
          id: 'a',
          source: 'DoubleTick',
          status: 'New',
          pipeline: 'Lead Pipeline',
        },
        {
          id: 'b',
          source: 'DoubleTick',
          status: 'HOT',
          pipeline: 'Lead Pipeline',
        },
        {
          id: 'c',
          source: 'Broadcast',
          status: 'New',
          pipeline: 'Lead Pipeline',
        },
      ],
    );
    const { bySource, total } = await service.getAnalytics(query);
    // Highest first: DoubleTick's two leads merge to 8.
    expect(bySource).toEqual([
      { label: 'DoubleTick', count: 8 },
      { label: 'Broadcast', count: 2 },
    ]);
    expect(total).toBe(10);
  });

  it('labels a stage with its pipeline initials, the way Workpex disambiguates them', async () => {
    const { service } = makeService(
      [],
      [
        { leadId: 'a', _count: { _all: 4 } },
        { leadId: 'b', _count: { _all: 1 } },
      ],
      [
        { id: 'a', source: null, status: 'New', pipeline: 'Lead Pipeline' },
        { id: 'b', source: null, status: 'CANCELLED', pipeline: 'LOGISTICS' },
      ],
    );
    const { byStage } = await service.getAnalytics(query);
    expect(byStage).toEqual([
      { label: 'New (LP)', count: 4 },
      { label: 'CANCELLED (LO)', count: 1 },
    ]);
  });

  it('buckets a source-less lead as Unknown rather than dropping its calls', async () => {
    const { service } = makeService(
      [],
      [{ leadId: 'a', _count: { _all: 6 } }],
      [{ id: 'a', source: '  ', status: 'New', pipeline: 'Lead Pipeline' }],
    );
    const { bySource, total } = await service.getAnalytics(query);
    expect(bySource).toEqual([{ label: 'Unknown', count: 6 }]);
    expect(total).toBe(6);
  });

  it('scopes to the caller for a sales agent and honours the agent filter', async () => {
    const { service, callGroupBy } = makeService(
      [],
      [],
      [],
      UserRole.SALES_AGENT,
    );
    await service.getAnalytics({ ...query, agentId: USER_ID });
    const { where } = (callGroupBy.mock.calls as unknown[][])[0][0] as {
      where: { agentId?: string; lead?: Record<string, unknown> };
    };
    expect(where.agentId).toBe(USER_ID);
    expect(where.lead).toMatchObject({
      assignments: { some: { userId: USER_ID } },
    });
  });

  it('returns empty panels for a period with no calls, without querying leads', async () => {
    const { service } = makeService([], [], []);
    const result = await service.getAnalytics(query);
    expect(result.bySource).toEqual([]);
    expect(result.byStage).toEqual([]);
    expect(result.total).toBe(0);
  });
});
