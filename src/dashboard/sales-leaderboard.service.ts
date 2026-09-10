import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CallLeaderboardService } from '../calls/call-leaderboard.service';
import {
  assignedInPeriodWhere,
  convertedInPeriodWhere,
} from './team-revenue.service';
import { DashboardPeriod, avatarUrlsByUser } from './dashboard-agents';

const ZERO = new Prisma.Decimal(0);

/**
 * One agent's card on the Sales Team Activity Board leaderboard (DASH-04.1).
 *
 * Both percentages are nullable and both are uncapped. Null means "cannot be
 * computed", which the reference renders as `NA` — not zero, which would claim the
 * agent achieved nothing. `convertedAmount` is a decimal string (money rule).
 */
export interface SalesLeaderboardEntry {
  agentId: string;
  agentName: string;
  avatarUrl: string | null;
  leads: number;
  calls: number;
  convertedAmount: string;
  /** Null when no leads were assigned in the period — a 0/0 rate, not a 0 % one. */
  conversionRate: number | null;
  /** Null when the member has no monthly goal set in Target Settings. */
  pctRevenueTargetAchieved: number | null;
}

const pct = (numerator: number, denominator: number): number =>
  Math.round((numerator / denominator) * 10000) / 100;

/**
 * The Sales Team Activity Board leaderboard (DASH-04.1).
 *
 * **Conversion Rate** is conversions *in* the period over leads *assigned* in the
 * period (owner ruling 2026-09-09). It is uncapped by construction and legitimately
 * exceeds 100 % whenever conversions land on leads assigned before the window
 * opened — which is what the reference's 105.00 % is. This is deliberately NOT the
 * Leads By Source report's rate (WON ÷ total, same window), which can never pass
 * 100 % and so could not reproduce the reference at all.
 *
 * **Calls** are read from `CallLeaderboardService`, the Call Dashboard's own
 * aggregation, so this column and the Call Activity Board below it can never
 * report different numbers for the same agent and period.
 *
 * Ranking is by converted value, then leads, then name — deterministic, tie-safe
 * (AC5), and never surfaced as a visible rank, because no rank badge appears
 * anywhere in the reference.
 */
@Injectable()
export class SalesLeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly storage: StorageService,
    private readonly callLeaderboard: CallLeaderboardService,
  ) {}

  async getLeaderboard(
    period: DashboardPeriod,
  ): Promise<SalesLeaderboardEntry[]> {
    const user = await this.currentUser.resolve();
    const assignedWhere = assignedInPeriodWhere(user, period);
    const convertedLeadWhere = convertedInPeriodWhere(user, period);
    const convertedWhere: Prisma.LeadAssignmentWhereInput = {
      lead: convertedLeadWhere,
    };

    const [assigned, converted, convertedValues, calls] = await Promise.all([
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: assignedWhere,
        _count: { _all: true },
      }),
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: convertedWhere,
        _count: { _all: true },
      }),
      // ponytail: Σ actualAmount per agent summed in-app — Prisma cannot sum a Lead
      // field across the assignment join. The same trade the Converted Leads and
      // Leads By Ownership reports already make; a scoped raw query if this ever
      // spans huge volume.
      this.prisma.leadAssignment.findMany({
        where: convertedWhere,
        select: { userId: true, lead: { select: { actualAmount: true } } },
      }),
      this.callLeaderboard.getLeaderboard({
        from: period.from,
        to: period.to,
      }),
    ]);

    const assignedByUser = new Map(
      assigned.map((row) => [row.userId, row._count._all]),
    );
    const convertedByUser = new Map(
      converted.map((row) => [row.userId, row._count._all]),
    );
    const callsByUser = new Map(
      calls.map((row) => [row.agentId, row.totalCalls]),
    );

    const valueByUser = new Map<string, Prisma.Decimal>();
    for (const row of convertedValues) {
      valueByUser.set(
        row.userId,
        (valueByUser.get(row.userId) ?? ZERO).add(
          row.lead.actualAmount ?? ZERO,
        ),
      );
    }

    // An agent earns a card by having been assigned a lead in the period or having
    // converted one in it. Agents are derived from activity rather than from a
    // roster for the same reason the Call Dashboard's board is: team scoping for a
    // full roster does not exist yet.
    const agentIds = [
      ...new Set([...assignedByUser.keys(), ...convertedByUser.keys()]),
    ];
    if (agentIds.length === 0) return [];

    const [members, avatars] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true, monthlyGoalAmount: true },
      }),
      avatarUrlsByUser(this.prisma, this.storage, agentIds),
    ]);
    const memberById = new Map(members.map((member) => [member.id, member]));

    return agentIds
      .map((agentId): SalesLeaderboardEntry => {
        const member = memberById.get(agentId);
        const leads = assignedByUser.get(agentId) ?? 0;
        const convertedCount = convertedByUser.get(agentId) ?? 0;
        const value = valueByUser.get(agentId) ?? ZERO;
        const goal = member?.monthlyGoalAmount ?? null;

        return {
          agentId,
          agentName: member?.name ?? 'Unknown',
          avatarUrl: avatars.get(agentId) ?? null,
          leads,
          calls: callsByUser.get(agentId) ?? 0,
          convertedAmount: value.toString(),
          conversionRate: leads > 0 ? pct(convertedCount, leads) : null,
          pctRevenueTargetAchieved:
            goal && !goal.isZero()
              ? Math.round(value.div(goal).toNumber() * 10000) / 100
              : null,
        };
      })
      .sort(
        (a, b) =>
          Number(b.convertedAmount) - Number(a.convertedAmount) ||
          b.leads - a.leads ||
          a.agentName.localeCompare(b.agentName),
      );
  }
}
