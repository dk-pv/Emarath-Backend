import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CallLeaderboardService } from '../calls/call-leaderboard.service';
import { SalesLeaderboardService } from './sales-leaderboard.service';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const dec = (n: string) => new Prisma.Decimal(n);
const group = (userId: string, n: number) => ({
  userId,
  _count: { _all: n },
});

type Options = {
  /** Leads assigned in the period, per agent. */
  assigned?: { userId: string; _count: { _all: number } }[];
  /** Leads converted in the period, per agent. */
  converted?: { userId: string; _count: { _all: number } }[];
  values?: { userId: string; lead: { actualAmount: Prisma.Decimal | null } }[];
  goals?: Record<string, Prisma.Decimal | null>;
  role?: UserRole;
};

function makeService(options: Options = {}) {
  const {
    // A converted 21 of the 20 leads assigned this period — the reference's own
    // 105 % case, which only happens because a conversion can land on a lead
    // assigned before the window opened.
    assigned = [group(A, 20), group(B, 8), group(C, 4)],
    converted = [group(A, 21), group(B, 4)],
    values = [
      { userId: A, lead: { actualAmount: dec('3120.50') } },
      { userId: B, lead: { actualAmount: dec('1000') } },
      { userId: B, lead: { actualAmount: null } },
    ],
    goals = { [A]: dec('260'), [B]: dec('50000'), [C]: null },
    role = UserRole.SUPERADMIN,
  } = options;

  const groupBy = jest.fn((args: { where: { lead?: { status?: string } } }) =>
    Promise.resolve(args.where.lead?.status === 'WON' ? converted : assigned),
  );

  const prisma = {
    leadAssignment: {
      groupBy,
      findMany: jest.fn().mockResolvedValue(values),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(
        [A, B, C].map((id) => ({
          id,
          name: { [A]: 'Ansar', [B]: 'Beth', [C]: 'Cara' }[id],
          monthlyGoalAmount: goals[id] ?? null,
        })),
      ),
    },
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: USER_ID, role }),
  } as unknown as CurrentUserService;
  const storage = {
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/avatar'),
  } as unknown as StorageService;
  const getCallLeaderboard = jest
    .fn()
    .mockResolvedValue([{ agentId: A, totalCalls: 37 }]);
  const callLeaderboard = {
    getLeaderboard: getCallLeaderboard,
  } as unknown as CallLeaderboardService;

  return {
    service: new SalesLeaderboardService(
      prisma,
      currentUser,
      storage,
      callLeaderboard,
    ),
    groupBy,
    getCallLeaderboard,
  };
}

const period = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
};

describe('SalesLeaderboardService.getLeaderboard', () => {
  it('lets Conversion Rate exceed 100% — converted-in-period ÷ assigned-in-period', async () => {
    const { service } = makeService();
    const rows = await service.getLeaderboard(period);
    // 21 conversions against 20 assignments = 105.00 %, uncapped (AC3).
    expect(rows.find((r) => r.agentId === A)!.conversionRate).toBe(105);
    expect(rows.find((r) => r.agentId === B)!.conversionRate).toBe(50);
  });

  it('reports NA (null) rather than 0% when no leads were assigned', async () => {
    const { service } = makeService({
      assigned: [group(A, 20)],
      converted: [group(A, 21), group(C, 2)],
    });
    const rows = await service.getLeaderboard(period);
    // C converted a lead assigned earlier, so it has no denominator at all —
    // that is "cannot be computed", not "converted nothing".
    expect(rows.find((r) => r.agentId === C)!.conversionRate).toBeNull();
  });

  it('computes % Revenue Target Achieved uncapped, and NA without a goal', async () => {
    const { service } = makeService();
    const rows = await service.getLeaderboard(period);
    // 3120.50 against a 260 goal = 1200.19 %, never clamped to 100.
    expect(rows.find((r) => r.agentId === A)!.pctRevenueTargetAchieved).toBe(
      1200.19,
    );
    // Cara has no monthly goal set → NA, not 0 %.
    expect(
      rows.find((r) => r.agentId === C)!.pctRevenueTargetAchieved,
    ).toBeNull();
  });

  it('sums converted amount as a decimal string, treating a null amount as zero', async () => {
    const { service } = makeService();
    const rows = await service.getLeaderboard(period);
    expect(rows.find((r) => r.agentId === A)!.convertedAmount).toBe('3120.5');
    expect(rows.find((r) => r.agentId === B)!.convertedAmount).toBe('1000');
    expect(rows.find((r) => r.agentId === C)!.convertedAmount).toBe('0');
  });

  it('takes the Calls column from the Call Dashboard aggregation', async () => {
    const { service, getCallLeaderboard } = makeService();
    const rows = await service.getLeaderboard(period);
    expect(getCallLeaderboard).toHaveBeenCalledWith({
      from: period.from,
      to: period.to,
    });
    expect(rows.find((r) => r.agentId === A)!.calls).toBe(37);
    // An agent with no calls in that aggregation is 0, never undefined.
    expect(rows.find((r) => r.agentId === C)!.calls).toBe(0);
  });

  it('ranks by converted value, then leads, then name (AC5)', async () => {
    const { service } = makeService();
    const rows = await service.getLeaderboard(period);
    expect(rows.map((r) => r.agentName)).toEqual(['Ansar', 'Beth', 'Cara']);
  });

  it('scopes to the caller for a sales agent (AC4)', async () => {
    const { service, groupBy } = makeService({ role: UserRole.SALES_AGENT });
    await service.getLeaderboard(period);
    const { where } = groupBy.mock.calls[0][0];
    expect(where.lead).toMatchObject({
      assignments: { some: { userId: USER_ID } },
    });
  });

  it('returns an empty board rather than querying members when nobody qualifies', async () => {
    const { service } = makeService({ assigned: [], converted: [] });
    await expect(service.getLeaderboard(period)).resolves.toEqual([]);
  });
});
