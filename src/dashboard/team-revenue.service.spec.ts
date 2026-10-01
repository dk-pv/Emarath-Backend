import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardPeriod } from './dashboard-agents';
import { TeamRevenueService } from './team-revenue.service';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const dec = (value: string) => new Prisma.Decimal(value);

const PERIOD: DashboardPeriod = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
};

interface Options {
  /** Σ actualAmount over the converted set, as `lead.aggregate` returns it. */
  converted?: Prisma.Decimal | null;
  /** Σ monthlyGoalAmount over the active members. */
  target?: Prisma.Decimal | null;
  assignments?: number;
  calls?: number;
  role?: UserRole;
}

function makeService(options: Options = {}) {
  const {
    converted = dec('3120.50'),
    target = dec('260'),
    assignments = 20,
    calls = 37,
    role = UserRole.SUPERADMIN,
  } = options;

  const assignmentCount = jest.fn().mockResolvedValue(assignments);
  const callCount = jest.fn().mockResolvedValue(calls);
  const leadAggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { actualAmount: converted } });
  const userAggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { monthlyGoalAmount: target } });

  const prisma = {
    leadAssignment: { count: assignmentCount },
    call: { count: callCount },
    lead: { aggregate: leadAggregate },
    user: { aggregate: userAggregate },
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: USER_ID, role }),
  } as unknown as CurrentUserService;

  return {
    service: new TeamRevenueService(prisma, currentUser),
    assignmentCount,
    callCount,
    leadAggregate,
    userAggregate,
  };
}

/** The `where` a stubbed Prisma read was given. */
function whereOf(mock: jest.Mock): Record<string, unknown> {
  const [args] = mock.mock.calls[0] as [{ where: Record<string, unknown> }];
  return args.where;
}

/*
  Characterization only (ADR-0085 §B): these pin what the board computes TODAY, so a
  Logistics-era change to the WON definition cannot move the revenue figure unnoticed.
  None of them states what the metric ought to become.
*/
describe('TeamRevenueService.getTeamRevenue — the converted set', () => {
  it('counts a lead as converted only when its status is exactly WON', async () => {
    const { service, leadAggregate } = makeService();

    await service.getTeamRevenue(PERIOD);

    const where = whereOf(leadAggregate);
    expect(where.status).toBe('WON');
    // Neither the "Converted" stage nor a QC stage is part of the definition today.
    const json = JSON.stringify(where);
    expect(json).not.toContain('Converted');
    expect(json).not.toContain('QC');
    expect(json).not.toContain('LOST');
  });

  it('dates a conversion by statusChangedAt, never by the lead’s creation', async () => {
    const { service, leadAggregate } = makeService();

    await service.getTeamRevenue(PERIOD);

    const where = whereOf(leadAggregate);
    // Half-open [from, to): the trigger-maintained column, so a month's revenue
    // follows the conversion and not the lead's creation date.
    expect(where.statusChangedAt).toEqual({
      gte: new Date(PERIOD.from as string),
      lt: new Date(PERIOD.to as string),
    });
    expect(where.createdAt).toBeUndefined();
  });

  it('drops every date predicate when the period is All', async () => {
    const { service, leadAggregate, assignmentCount, callCount } =
      makeService();

    await service.getTeamRevenue({});

    expect(whereOf(leadAggregate).statusChangedAt).toBeUndefined();
    expect(whereOf(assignmentCount).createdAt).toBeUndefined();
    expect(whereOf(callCount).startedAt).toBeUndefined();
  });

  it('leaves archived leads out, through the shared lead scope', async () => {
    const { service, leadAggregate } = makeService();

    await service.getTeamRevenue(PERIOD);

    // `deletedAt: null` comes from leadScopeWhere; a soft-deleted WON lead is not revenue.
    expect(whereOf(leadAggregate).deletedAt).toBeNull();
  });

  it('limits a sales agent to the leads assigned to them', async () => {
    const { service, leadAggregate } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.getTeamRevenue(PERIOD);

    expect(whereOf(leadAggregate)).toMatchObject({
      status: 'WON',
      assignments: { some: { userId: USER_ID } },
    });
  });
});

describe('TeamRevenueService.getTeamRevenue — the figures', () => {
  it('counts leads by the assignment’s own date, and calls by startedAt', async () => {
    const { service, assignmentCount, callCount } = makeService();

    const result = await service.getTeamRevenue(PERIOD);

    expect(result.totalLeads).toBe(20);
    expect(result.totalCalls).toBe(37);
    // "Assigned in the period" — the assignment row's createdAt, not the lead's.
    expect(whereOf(assignmentCount).createdAt).toEqual({
      gte: new Date(PERIOD.from as string),
      lt: new Date(PERIOD.to as string),
    });
    expect(whereOf(callCount).startedAt).toEqual({
      gte: new Date(PERIOD.from as string),
      lt: new Date(PERIOD.to as string),
    });
  });

  it('returns the conversion as a decimal string, and zero when nothing converted', async () => {
    const { service } = makeService();
    await expect(service.getTeamRevenue(PERIOD)).resolves.toMatchObject({
      totalConversion: '3120.5',
    });

    const empty = makeService({ converted: null });
    await expect(empty.service.getTeamRevenue(PERIOD)).resolves.toMatchObject({
      totalConversion: '0',
    });
  });

  it('leaves % target achieved uncapped, at two decimals', async () => {
    const { service } = makeService();

    const result = await service.getTeamRevenue(PERIOD);

    // 3120.50 against a 260 target = 1200.19 %, never clamped (AC5).
    expect(result.pctRevenueTargetAchieved).toBe(1200.19);
  });

  it('reports NA (null) rather than 0 % when the team has no target', async () => {
    const zero = makeService({ target: dec('0') });
    await expect(zero.service.getTeamRevenue(PERIOD)).resolves.toMatchObject({
      pctRevenueTargetAchieved: null,
    });

    const none = makeService({ target: null });
    await expect(none.service.getTeamRevenue(PERIOD)).resolves.toMatchObject({
      pctRevenueTargetAchieved: null,
    });
  });

  /*
    Current behaviour, pinned because it surprises: the target is organisation-wide even
    for a sales agent, whose numerator is their own leads only — the percentage is not a
    like-for-like ratio for that caller.
  */
  it('takes the target from every active member, whoever is asking', async () => {
    const { service, userAggregate } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.getTeamRevenue(PERIOD);

    expect(whereOf(userAggregate)).toEqual({ deletedAt: null, isActive: true });
  });

  it('keeps a one-sided period one-sided, on whichever bound was given', async () => {
    const open = makeService();
    await open.service.getTeamRevenue({ from: PERIOD.from });
    expect(whereOf(open.leadAggregate).statusChangedAt).toEqual({
      gte: new Date(PERIOD.from as string),
    });

    const until = makeService();
    await until.service.getTeamRevenue({ to: PERIOD.to });
    // The upper bound stays exclusive (`lt`): a conversion at exactly `to` belongs
    // to the next period, never to both.
    expect(whereOf(until.leadAggregate).statusChangedAt).toEqual({
      lt: new Date(PERIOD.to as string),
    });
  });

  it('reports an all-zero board rather than failing when nothing matches', async () => {
    const { service } = makeService({
      assignments: 0,
      calls: 0,
      converted: null,
      target: null,
    });

    await expect(service.getTeamRevenue(PERIOD)).resolves.toEqual({
      totalLeads: 0,
      totalCalls: 0,
      totalConversion: '0',
      pctRevenueTargetAchieved: null,
    });
  });
});
