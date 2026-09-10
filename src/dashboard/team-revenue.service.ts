import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { leadScopeWhere } from '../leads/lead-scope';
import { callScopeWhere } from '../calls/call-scope';
import { DashboardPeriod, periodFilter } from './dashboard-agents';

const ZERO = new Prisma.Decimal(0);

/**
 * The Sales Team Activity Board's left rail (DASH-03.1).
 *
 * `totalConversion` is a decimal string, never a number — the money rule: precision
 * must survive the wire. `pctRevenueTargetAchieved` is null when the team has no
 * revenue target set at all, which the UI renders as `NA`; it is deliberately
 * uncapped, because beating a target is the normal case in the reference (AC5).
 */
export interface TeamRevenue {
  totalLeads: number;
  totalCalls: number;
  totalConversion: string;
  pctRevenueTargetAchieved: number | null;
}

/**
 * "Converted" is `status = WON` and the converted value is the lead's
 * `actualAmount` — the approved definition, reused verbatim from the Converted
 * Leads report so the Dashboard and that report can never disagree.
 *
 * A conversion belongs to the period in which the status *changed*, which the
 * `leads_status_changed_at` trigger maintains. That is deliberately not the
 * `createdAt` window the RPT-02.x reports filter on: those answer "created in the
 * period and currently WON", where a revenue board has to answer "converted in the
 * period" or a month's revenue would follow the lead's creation date.
 */
export function convertedInPeriodWhere(
  user: CurrentUser,
  period: DashboardPeriod,
): Prisma.LeadWhereInput {
  const changed = periodFilter(period);
  return {
    ...leadScopeWhere(user),
    status: 'WON',
    ...(changed ? { statusChangedAt: changed } : {}),
  };
}

/** Leads **assigned** in the period — the same rule the Todays Leads counter uses. */
export function assignedInPeriodWhere(
  user: CurrentUser,
  period: DashboardPeriod,
): Prisma.LeadAssignmentWhereInput {
  const created = periodFilter(period);
  return {
    lead: leadScopeWhere(user),
    ...(created ? { createdAt: created } : {}),
  };
}

@Injectable()
export class TeamRevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getTeamRevenue(period: DashboardPeriod): Promise<TeamRevenue> {
    const user = await this.currentUser.resolve();
    const startedAt = periodFilter(period);

    const [totalLeads, totalCalls, conversion, targets] = await Promise.all([
      this.prisma.leadAssignment.count({
        where: assignedInPeriodWhere(user, period),
      }),
      this.prisma.call.count({
        where: {
          ...callScopeWhere(user),
          ...(startedAt ? { startedAt } : {}),
        },
      }),
      this.prisma.lead.aggregate({
        where: convertedInPeriodWhere(user, period),
        _sum: { actualAmount: true },
      }),
      // The target is the sum of the monthly goals of the members this caller can
      // see — Target Settings' `monthlyGoalAmount`. A member with no goal set
      // contributes nothing rather than a zero that would distort the percentage.
      this.prisma.user.aggregate({
        where: { deletedAt: null, isActive: true },
        _sum: { monthlyGoalAmount: true },
      }),
    ]);

    const converted = conversion._sum.actualAmount ?? ZERO;
    const target = targets._sum.monthlyGoalAmount ?? ZERO;

    return {
      totalLeads,
      totalCalls,
      totalConversion: converted.toString(),
      // Never clamped: the reference's own board reads 567 % (AC5). Null — not
      // zero — when no target exists, so the UI can say NA instead of implying
      // the team achieved nothing.
      pctRevenueTargetAchieved: target.isZero()
        ? null
        : Math.round(converted.div(target).toNumber() * 10000) / 100,
    };
  }
}
