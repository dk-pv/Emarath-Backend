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
  startedAt: { gte: Date };
  outcome?: CallOutcome;
  direction?: CallDirection;
  lead?: Record<string, unknown>;
};

/**
 * Drives the aggregates off the `where` argument, not call order — the two
 * windows resolve concurrently, so an order-based mock would be flaky. `current`
 * is the window whose gte equals `from`; every other window is empty.
 */
function makeService(
  current: {
    total: number;
    answered: number;
    outbound: number;
    seconds: number;
    unique: number;
  },
  previous = { total: 0, answered: 0, outbound: 0, seconds: 0, unique: 0 },
  role: UserRole = UserRole.SUPERADMIN,
) {
  const pick = (w: Where) =>
    w.startedAt.gte.getTime() === new Date(FROM).getTime() ? current : previous;

  const count = jest.fn((args: { where: Where }) => {
    const m = pick(args.where);
    if (args.where.outcome === CallOutcome.ANSWERED)
      return Promise.resolve(m.answered);
    if (args.where.direction === CallDirection.OUTBOUND)
      return Promise.resolve(m.outbound);
    return Promise.resolve(m.total);
  });
  const aggregate = jest.fn((args: { where: Where }) =>
    Promise.resolve({ _sum: { duration: pick(args.where).seconds } }),
  );
  const groupBy = jest.fn((args: { where: Where }) =>
    Promise.resolve(
      Array.from({ length: pick(args.where).unique }, (_, i) => ({
        leadId: `l${i}`,
      })),
    ),
  );

  const prisma = {
    call: { count, aggregate, groupBy },
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
  it('returns exactly the six backlog KPIs (no Inbound/Missed/Abandoned)', async () => {
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
        'averageCallTime',
        'callConnectPct',
        'outboundCalls',
        'totalCallMinutes',
        'totalCalls',
        'uniqueCalls',
      ].sort(),
    );
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
    expect(where.startedAt.gte.getTime()).toBe(startOfToday.getTime());
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
