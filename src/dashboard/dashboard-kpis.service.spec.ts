import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { KPI_KEYS } from './dashboard-kpis';
import { DashboardKpisService } from './dashboard-kpis.service';
import { DashboardKpisQueryDto } from './dto/dashboard-kpis-query.dto';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const TODAY_START = '2026-08-29T00:00:00.000Z';
const FROM = '2026-08-01T00:00:00.000Z';
const TO = '2026-09-01T00:00:00.000Z';

type Counts = { activity?: number; lead?: number; call?: number };

function makeService(
  counts: Counts = {},
  role: UserRole = UserRole.SUPERADMIN,
) {
  const activityCount = jest.fn().mockResolvedValue(counts.activity ?? 0);
  const leadCount = jest.fn().mockResolvedValue(counts.lead ?? 0);
  const callCount = jest.fn().mockResolvedValue(counts.call ?? 0);

  const prisma = {
    activity: { count: activityCount },
    lead: { count: leadCount },
    call: { count: callCount },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: USER_ID, role }),
  } as unknown as CurrentUserService;

  return {
    service: new DashboardKpisService(prisma, currentUser),
    activityCount,
    leadCount,
    callCount,
  };
}

const query = (
  overrides: Partial<DashboardKpisQueryDto> = {},
): DashboardKpisQueryDto => ({
  todayStart: TODAY_START,
  from: FROM,
  to: TO,
  ...overrides,
});

describe('DashboardKpisService.getKpis', () => {
  it('returns every counter when none are named (AC1)', async () => {
    const { service } = makeService();
    const kpis = await service.getKpis(query());
    expect(Object.keys(kpis).sort()).toEqual([...KPI_KEYS].sort());
  });

  it('computes only the counters a card asked for (AC2 — per-widget periods)', async () => {
    const { service, activityCount, leadCount, callCount } = makeService();
    const kpis = await service.getKpis(query({ counters: ['hotLeads'] }));
    expect(Object.keys(kpis)).toEqual(['hotLeads']);
    // One lead count, and nothing else queried — six filtered cards must not each
    // sweep all six counters.
    expect(leadCount).toHaveBeenCalledTimes(1);
    expect(activityCount).not.toHaveBeenCalled();
    expect(callCount).not.toHaveBeenCalled();
  });

  it('aggregates each counter from its own source table (AC4)', async () => {
    const { service } = makeService({ activity: 7, lead: 12, call: 30 });
    const kpis = await service.getKpis(query());
    expect(kpis.overdueFollowUps).toEqual({ value: 7, status: 'ok' });
    expect(kpis.todaysFollowUps).toEqual({ value: 7, status: 'ok' });
    expect(kpis.todaysLeads).toEqual({ value: 12, status: 'ok' });
    expect(kpis.hotLeads).toEqual({ value: 12, status: 'ok' });
    expect(kpis.outboundCalls).toEqual({ value: 30, status: 'ok' });
  });

  it('returns zeros without error for a period with no data (AC5)', async () => {
    const { service } = makeService({ activity: 0, lead: 0, call: 0 });
    const kpis = await service.getKpis(query());
    expect(kpis.overdueFollowUps?.value).toBe(0);
    expect(kpis.todaysFollowUps?.value).toBe(0);
    expect(kpis.todaysLeads?.value).toBe(0);
    expect(kpis.hotLeads?.value).toBe(0);
    expect(kpis.outboundCalls?.value).toBe(0);
  });

  it('reports Qualified Leads as pending, never as a number', async () => {
    const { service, leadCount } = makeService({ lead: 99 });
    const kpis = await service.getKpis(query({ counters: ['qualifiedLeads'] }));
    expect(kpis.qualifiedLeads?.value).toBeNull();
    expect(kpis.qualifiedLeads?.status).toBe('pending-definition');
    // Critically: it must not borrow another counter's query.
    expect(leadCount).not.toHaveBeenCalled();
  });

  it('scopes every counter to the caller for a sales agent (AC3)', async () => {
    const { service, activityCount, leadCount, callCount } = makeService(
      {},
      UserRole.SALES_AGENT,
    );
    await service.getKpis(query());
    const whereOf = (mock: jest.Mock): string[] =>
      (mock.mock.calls as unknown[][]).map((call) =>
        JSON.stringify((call[0] as { where: unknown }).where),
      );
    const everyWhere = [
      ...whereOf(activityCount),
      ...whereOf(leadCount),
      ...whereOf(callCount),
    ];
    // Every counted query — all but Qualified Leads, which is never counted.
    expect(everyWhere).toHaveLength(KPI_KEYS.length - 1);
    for (const where of everyWhere) expect(where).toContain(USER_ID);
  });

  it('scopes by team for a sales manager (AC3)', async () => {
    const activityCount = jest.fn().mockResolvedValue(0);
    const leadCount = jest.fn().mockResolvedValue(0);
    const callCount = jest.fn().mockResolvedValue(0);
    const prisma = {
      activity: { count: activityCount },
      lead: { count: leadCount },
      call: { count: callCount },
    } as unknown as PrismaService;
    const currentUser = {
      resolve: jest.fn().mockResolvedValue({
        id: USER_ID,
        role: UserRole.SALES_MANAGER,
        team: 'Team A',
      }),
    } as unknown as CurrentUserService;

    await new DashboardKpisService(prisma, currentUser).getKpis(
      query({ counters: ['todaysLeads', 'hotLeads'] }),
    );
    for (const call of leadCount.mock.calls) {
      expect(JSON.stringify((call as [{ where: unknown }])[0].where)).toContain(
        'Team A',
      );
    }
  });

  it('passes the caller period through to the queries (AC2)', async () => {
    const { service, callCount } = makeService();
    await service.getKpis(query({ counters: ['outboundCalls'] }));
    const { where } = (callCount.mock.calls as unknown[][])[0][0] as {
      where: { startedAt: { gte: Date; lt: Date } };
    };
    expect(where.startedAt).toEqual({
      gte: new Date(FROM),
      lt: new Date(TO),
    });
  });

  it('supports the All period by sending no date bounds', async () => {
    const { service, callCount } = makeService();
    await service.getKpis(
      query({ from: undefined, to: undefined, counters: ['outboundCalls'] }),
    );
    const { where } = (callCount.mock.calls as unknown[][])[0][0] as {
      where: { startedAt?: unknown };
    };
    expect(where.startedAt).toBeUndefined();
  });

  it('rejects an inverted range once, not silently in five queries', async () => {
    const { service, leadCount } = makeService();
    await expect(
      service.getKpis(query({ from: TO, to: FROM })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(leadCount).not.toHaveBeenCalled();
  });
});

/*
  The control row's Sales Agent selection. It is one more AND term on each counter's already
  scoped query, so it can narrow what the caller sees and never widen it.
*/
describe('DashboardKpisService — Sales Agent selection', () => {
  const OTHER = '33333333-3333-3333-3333-333333333333';
  const wheres = (mock: jest.Mock): unknown[] =>
    (mock.mock.calls as unknown[][]).map(
      (call) => (call[0] as { where: unknown }).where,
    );

  it('narrows every counted query to the selected agents, on the right join', async () => {
    const { service, activityCount, leadCount, callCount } = makeService();
    await service.getKpis(query({ agent: [OTHER] }));

    for (const where of wheres(leadCount)) {
      expect(where).toMatchObject({
        AND: [{}, { assignments: { some: { userId: { in: [OTHER] } } } }],
      });
    }
    for (const where of wheres(activityCount)) {
      expect(where).toMatchObject({
        AND: [{}, { assignees: { some: { userId: { in: [OTHER] } } } }],
      });
    }
    for (const where of wheres(callCount)) {
      expect(where).toMatchObject({ AND: [{}, { agentId: { in: [OTHER] } }] });
    }
  });

  it('keeps the caller’s own scope under the selection — it can only narrow', async () => {
    const { service, activityCount, leadCount, callCount } = makeService(
      {},
      UserRole.SALES_AGENT,
    );
    await service.getKpis(query({ agent: [OTHER] }));
    const every = [
      ...wheres(activityCount),
      ...wheres(leadCount),
      ...wheres(callCount),
    ].map((where) => JSON.stringify(where));
    expect(every).toHaveLength(KPI_KEYS.length - 1);
    for (const where of every) {
      expect(where).toContain(USER_ID);
      expect(where).toContain(OTHER);
    }
  });

  it('adds nothing when no agent is selected', async () => {
    const { service, leadCount } = makeService();
    await service.getKpis(query({ counters: ['hotLeads'] }));
    expect(JSON.stringify(wheres(leadCount)[0])).not.toContain(
      '"userId":{"in"',
    );
  });
});

describe('DashboardKpisQueryDto — agent', () => {
  const parse = async (agent: unknown) => {
    const dto = plainToInstance(DashboardKpisQueryDto, {
      todayStart: TODAY_START,
      agent,
    });
    return { dto, errors: (await validate(dto)).map((e) => e.property) };
  };

  it('reads the control row’s comma list, as the URL carries it', async () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '44444444-4444-4444-8444-444444444444';
    const { dto, errors } = await parse(`${A}, ${B}`);
    expect(errors).toEqual([]);
    expect(dto.agent).toEqual([A, B]);
  });

  it('refuses anything that is not a user id', async () => {
    expect((await parse('not-an-id')).errors).toEqual(['agent']);
  });
});
