import {
  CallDirection,
  CallOutcome,
  UserRole,
} from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CallLeaderboardService } from './call-leaderboard.service';
import { CallSummaryQueryDto } from './dto/call-summary-query.dto';

const AGENT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AGENT_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const FROM = '2026-07-27T00:00:00.000Z';
const TO = '2026-07-28T00:00:00.000Z';

type Where = {
  outcome?: CallOutcome | { not: CallOutcome };
  direction?: CallDirection;
  lead?: Record<string, unknown>;
};

function count(agentId: string, n: number) {
  return { agentId, _count: { _all: n } };
}

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  // totals: A and B tie at 16; C has 5. answered: B 12 > A 9 > C 0.
  const totals = [count(AGENT_A, 16), count(AGENT_B, 16), count(AGENT_C, 5)];
  const answered = [count(AGENT_A, 9), count(AGENT_B, 12)];
  const missed = [count(AGENT_B, 2)];
  const contacts = [
    ...Array.from({ length: 10 }, (_, i) => ({
      agentId: AGENT_A,
      leadId: `a${i}`,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      agentId: AGENT_B,
      leadId: `b${i}`,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      agentId: AGENT_C,
      leadId: `c${i}`,
    })),
  ];

  const groupBy = jest.fn((args: { by: string[]; where: Where }) => {
    if (args.by.length === 2) return Promise.resolve(contacts);
    if (args.where.direction === CallDirection.INBOUND)
      return Promise.resolve(missed);
    if (args.where.outcome === CallOutcome.ANSWERED)
      return Promise.resolve(answered);
    return Promise.resolve(totals);
  });
  const findMany = jest.fn().mockResolvedValue([
    { id: AGENT_A, name: 'Ansar' },
    { id: AGENT_B, name: 'Beth' },
    { id: AGENT_C, name: 'Cara' },
  ]);

  const prisma = {
    call: { groupBy },
    user: { findMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: USER_ID, role }),
  } as unknown as CurrentUserService;

  return { service: new CallLeaderboardService(prisma, currentUser), groupBy };
}

function query(): CallSummaryQueryDto {
  return { from: FROM, to: TO };
}

describe('CallLeaderboardService.getLeaderboard', () => {
  it('returns per-agent metrics with Connect % as Answered ÷ Total (AC1)', async () => {
    const { service } = makeService();
    const rows = await service.getLeaderboard(query());
    const ansar = rows.find((r) => r.agentId === AGENT_A)!;
    expect(ansar).toMatchObject({
      agentName: 'Ansar',
      totalCalls: 16,
      uniqueCalls: 10,
      answeredCalls: 9,
      missedCalls: 0,
      callConnectPct: 56.25,
    });
    expect(rows.find((r) => r.agentId === AGENT_B)!.callConnectPct).toBe(75);
  });

  it('counts Missed as inbound-and-not-answered, not total-unanswered', async () => {
    const { service, groupBy } = makeService();
    await service.getLeaderboard(query());
    const missedCall = (groupBy.mock.calls as unknown[][])
      .map((c) => c[0] as { where: Where })
      .find((a) => a.where.direction === CallDirection.INBOUND)!;
    expect(missedCall.where).toMatchObject({
      direction: CallDirection.INBOUND,
      outcome: { not: CallOutcome.ANSWERED },
    });
  });

  it('ranks by total, then answered, then name — ties handled (AC5)', async () => {
    const { service } = makeService();
    const rows = await service.getLeaderboard(query());
    // A and B tie at 16; B has more answered → B first. C (5 calls) last.
    expect(rows.map((r) => r.agentName)).toEqual(['Beth', 'Ansar', 'Cara']);
  });

  it('gives a zero-activity agent a 0% connect without dividing by zero (AC5)', async () => {
    const { service } = makeService();
    const rows = await service.getLeaderboard(query());
    expect(rows.find((r) => r.agentId === AGENT_C)!.callConnectPct).toBe(0);
  });

  it('scopes the aggregation to the caller for a sales agent (AC3)', async () => {
    const { service, groupBy } = makeService(UserRole.SALES_AGENT);
    await service.getLeaderboard(query());
    const { where } = (groupBy.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    expect(where.lead).toMatchObject({
      assignments: { some: { userId: USER_ID } },
    });
  });
});
