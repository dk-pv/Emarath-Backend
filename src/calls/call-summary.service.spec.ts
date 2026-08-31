import {
  CallDirection,
  CallOutcome,
  UserRole,
} from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CallSummaryService } from './call-summary.service';
import { CallSummaryQueryDto } from './dto/call-summary-query.dto';

const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const FROM = '2026-07-27T00:00:00.000Z';
const TO = '2026-07-28T00:00:00.000Z';

type Where = {
  startedAt: { gte?: Date; lt?: Date };
  outcome?: CallOutcome | { not: CallOutcome };
  direction?: CallDirection;
  duration?: number;
  lead?: Record<string, unknown>;
};

type Metrics = {
  total: number;
  answered: number;
  outbound: number;
  inbound: number;
  missed: number;
  abandoned: number;
  seconds: number;
  unique: number;
  /** Contacts already called before the window — total unique minus these = fresh. */
  seenBefore: number;
  followUpCompleted: number;
};

const ZERO: Metrics = {
  total: 0,
  answered: 0,
  outbound: 0,
  inbound: 0,
  missed: 0,
  abandoned: 0,
  seconds: 0,
  unique: 0,
  seenBefore: 0,
  followUpCompleted: 0,
};

/**
 * Drives the aggregates off the `where` argument, not call order — the two
 * windows resolve concurrently, so an order-based mock would be flaky. `current`
 * is the window whose gte equals `from`; every other window is empty.
 */
function makeService(
  currentOverrides: Partial<Metrics>,
  previousOverrides: Partial<Metrics> = {},
  role: UserRole = UserRole.SUPERADMIN,
) {
  const current = { ...ZERO, ...currentOverrides };
  const previous = { ...ZERO, ...previousOverrides };
  const pick = (w: Where) =>
    w.startedAt.gte?.getTime() === new Date(FROM).getTime()
      ? current
      : previous;

  const count = jest.fn((args: { where: Where }) => {
    const m = pick(args.where);
    const w = args.where;
    if (w.outcome === CallOutcome.ANSWERED) return Promise.resolve(m.answered);
    if (w.direction === CallDirection.OUTBOUND)
      return Promise.resolve(m.outbound);
    if (w.direction === CallDirection.INBOUND) {
      if (w.duration === 0) return Promise.resolve(m.abandoned);
      if (typeof w.outcome === 'object') return Promise.resolve(m.missed);
      return Promise.resolve(m.inbound);
    }
    return Promise.resolve(m.total);
  });
  const aggregate = jest.fn((args: { where: Where }) =>
    Promise.resolve({ _sum: { duration: pick(args.where).seconds } }),
  );
  const groupBy = jest.fn((args: { where: Where }) => {
    // The fresh-calls lookback has no `gte` — it asks which of the contacted
    // leads were already known before the window opened.
    const size = args.where.startedAt.gte
      ? pick(args.where).unique
      : current.seenBefore;
    return Promise.resolve(
      Array.from({ length: size }, (_, i) => ({ leadId: `l${i}` })),
    );
  });
  const activityCount = jest.fn((args: { where: { completedAt: Where['startedAt'] } }) =>
    Promise.resolve(
      args.where.completedAt.gte?.getTime() === new Date(FROM).getTime()
        ? current.followUpCompleted
        : previous.followUpCompleted,
    ),
  );

  const prisma = {
    call: { count, aggregate, groupBy },
    activity: { count: activityCount },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role }),
  } as unknown as CurrentUserService;

  const service = new CallSummaryService(prisma, currentUser);
  return { service, count };
}

function query(
  overrides: Partial<CallSummaryQueryDto> = {},
): CallSummaryQueryDto {
  return { from: FROM, to: TO, ...overrides };
}

describe('CallSummaryService.getSummary', () => {
  it('returns the full Workpex carousel: the six backlog KPIs plus the five ruled in', async () => {
    const { service } = makeService({
      total: 16,
      answered: 9,
      outbound: 12,
      seconds: 1356,
      unique: 10,
    });
    const summary = await service.getSummary(query());
    expect(Object.keys(summary).sort()).toEqual(
      [
        'abandonedCalls',
        'averageCallTime',
        'callConnectPct',
        'followUpCallsCompleted',
        'freshCalls',
        'inboundCalls',
        'missedCalls',
        'outboundCalls',
        'totalCallMinutes',
        'totalCalls',
        'uniqueCalls',
      ].sort(),
    );
  });

  it('counts Fresh Calls as contacts with no call before the window opened', async () => {
    // 10 contacts reached, 4 of them already had a call on record → 6 are fresh.
    const { service } = makeService({ total: 16, unique: 10, seenBefore: 4 });
    expect((await service.getSummary(query())).freshCalls.value).toBe(6);
  });

  it('never reports a negative Fresh Calls when every contact was known', async () => {
    const { service } = makeService({ total: 9, unique: 5, seenBefore: 5 });
    expect((await service.getSummary(query())).freshCalls.value).toBe(0);
  });

  it('separates Inbound, Missed and Abandoned — Abandoned is a subset of Missed', async () => {
    const { service } = makeService({
      total: 20,
      inbound: 7,
      missed: 4,
      abandoned: 3,
    });
    const s = await service.getSummary(query());
    expect(s.inboundCalls.value).toBe(7);
    expect(s.missedCalls.value).toBe(4);
    expect(s.abandonedCalls.value).toBe(3);
    expect(s.abandonedCalls.value).toBeLessThanOrEqual(s.missedCalls.value);
  });

  it('takes Follow-up Calls Completed from completed CALL activities, not the call log', async () => {
    const { service } = makeService({ total: 16, followUpCompleted: 5 });
    expect(
      (await service.getSummary(query())).followUpCallsCompleted.value,
    ).toBe(5);
  });

  it('computes each KPI from the call log (AC3)', async () => {
    const { service } = makeService({
      total: 16,
      answered: 9,
      outbound: 12,
      seconds: 1356,
      unique: 10,
    });
    const s = await service.getSummary(query());
    expect(s.totalCalls.value).toBe(16);
    expect(s.uniqueCalls.value).toBe(10);
    expect(s.totalCallMinutes.value).toBe(22.6); // 1356s ÷ 60
    expect(s.averageCallTime.value).toBe(2.51); // 22.6 min ÷ 9 answered
    expect(s.outboundCalls.value).toBe(12);
  });

  it('computes Call Connect % as Answered ÷ Total × 100 — Option A, not unique-based', async () => {
    const { service } = makeService({
      total: 16,
      answered: 9,
      outbound: 12,
      seconds: 1356,
      unique: 10,
    });
    const s = await service.getSummary(query());
    expect(s.callConnectPct.value).toBe(56.25); // 9/16 — a unique-based figure could not be 56.25
  });

  it('reports day-over-day change against the preceding period (AC2)', async () => {
    const { service } = makeService(
      { total: 16, answered: 9, outbound: 12, seconds: 1356, unique: 10 },
      { total: 8, answered: 4, outbound: 6, seconds: 600, unique: 5 },
    );
    const s = await service.getSummary(query());
    expect(s.totalCalls.changePct).toBe(100); // (16-8)/8 ×100
    expect(s.outboundCalls.changePct).toBe(100); // (12-6)/6 ×100
  });

  it('returns a null change when the previous period was zero', async () => {
    const { service } = makeService({
      total: 16,
      answered: 9,
      outbound: 12,
      seconds: 1356,
      unique: 10,
    });
    const s = await service.getSummary(query());
    expect(s.totalCalls.changePct).toBeNull();
  });

  it('yields zeroed metrics for an empty period without dividing by zero', async () => {
    const { service } = makeService({
      total: 0,
      answered: 0,
      outbound: 0,
      seconds: 0,
      unique: 0,
    });
    const s = await service.getSummary(query());
    expect(s.callConnectPct.value).toBe(0);
    expect(s.averageCallTime.value).toBe(0);
    expect(s.totalCalls.changePct).toBeNull();
  });

  it('defaults the period to Today when no filter is supplied (AC5)', async () => {
    const { service, count } = makeService({
      total: 0,
      answered: 0,
      outbound: 0,
      seconds: 0,
      unique: 0,
    });
    await service.getSummary({});
    const { where } = (count.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    // `gte` is optional on the widened Where (the fresh-calls lookback has none),
    // so assert it is actually present here rather than asserting through it.
    expect(where.startedAt.gte?.getTime()).toBe(startOfToday.getTime());
  });

  it('scopes calls to the caller for a sales agent (AC5 role scoping)', async () => {
    const { service, count } = makeService(
      { total: 0, answered: 0, outbound: 0, seconds: 0, unique: 0 },
      undefined,
      UserRole.SALES_AGENT,
    );
    await service.getSummary(query());
    const { where } = (count.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    expect(where.lead).toMatchObject({
      assignments: { some: { userId: AGENT_ID } },
    });
  });
});
