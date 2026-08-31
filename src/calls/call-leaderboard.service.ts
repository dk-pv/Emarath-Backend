import { Injectable } from '@nestjs/common';
import { CallDirection, CallOutcome, Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { callScopeWhere } from './call-scope';
import { callConnectPct } from './call-connect';
import { resolvePeriod } from './call-period';
import { CallSummaryQueryDto } from './dto/call-summary-query.dto';

/** One agent's ranked call metrics for the period (CALL-04.1). */
export type LeaderboardEntry = {
  /** The drill-through key (AC4) — the agent's detailed activity is the Call Log (CALL-05.x). */
  agentId: string;
  agentName: string;
  totalCalls: number;
  uniqueCalls: number;
  answeredCalls: number;
  missedCalls: number;
  callConnectPct: number;
};

/**
 * Ranks agents by call volume and quality for the period (CALL-04.1). Reuses the
 * summary's `callScopeWhere` and `resolvePeriod`, so scope and period match the
 * KPIs exactly. Agents are derived from the calls in scope — an agent appears
 * when they have at least one call in the period, mirroring the Workpex board;
 * a team roster of zero-activity agents needs team scoping that does not exist
 * yet (deferred, as in Leads).
 */
@Injectable()
export class CallLeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getLeaderboard(
    query: CallSummaryQueryDto,
  ): Promise<LeaderboardEntry[]> {
    const user = await this.currentUser.resolve();
    const scope = callScopeWhere(user);
    const { start, end } = resolvePeriod(query);
    const where: Prisma.CallWhereInput = {
      ...scope,
      startedAt: { gte: start, lt: end },
      // The Filter popup's "Select User" leg — narrows the board to one agent
      // on top of role scoping, never around it.
      ...(query.agentId ? { agentId: query.agentId } : {}),
    };

    const [totals, answered, missed, contactGroups] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['agentId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.call.groupBy({
        by: ['agentId'],
        where: { ...where, outcome: CallOutcome.ANSWERED },
        _count: { _all: true },
      }),
      // Missed = an inbound call not answered (Change Request: "incoming calls
      // not answered"). The video's Missed = 0 while 7 calls went unanswered
      // proves it is inbound-scoped, not total-unanswered.
      this.prisma.call.groupBy({
        by: ['agentId'],
        where: {
          ...where,
          direction: CallDirection.INBOUND,
          outcome: { not: CallOutcome.ANSWERED },
        },
        _count: { _all: true },
      }),
      // One row per (agent, contact) → distinct contacts per agent.
      this.prisma.call.groupBy({ by: ['agentId', 'leadId'], where }),
    ]);

    const answeredByAgent = new Map(
      answered.map((row) => [row.agentId, row._count._all]),
    );
    const missedByAgent = new Map(
      missed.map((row) => [row.agentId, row._count._all]),
    );
    const uniqueByAgent = new Map<string, number>();
    for (const group of contactGroups) {
      uniqueByAgent.set(
        group.agentId,
        (uniqueByAgent.get(group.agentId) ?? 0) + 1,
      );
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: totals.map((row) => row.agentId) } },
      select: { id: true, name: true },
    });
    const nameByAgent = new Map(users.map((u) => [u.id, u.name]));

    return (
      totals
        .map((row): LeaderboardEntry => {
          const totalCalls = row._count._all;
          const answeredCalls = answeredByAgent.get(row.agentId) ?? 0;
          return {
            agentId: row.agentId,
            agentName: nameByAgent.get(row.agentId) ?? 'Unknown',
            totalCalls,
            uniqueCalls: uniqueByAgent.get(row.agentId) ?? 0,
            answeredCalls,
            missedCalls: missedByAgent.get(row.agentId) ?? 0,
            // The one shared Connect % computation (CALL-07.1); zero-safe.
            callConnectPct: callConnectPct(answeredCalls, totalCalls),
          };
        })
        // Rank by volume, then quality, then name — a stable, clear order that
        // never breaks on ties (AC5).
        .sort(
          (a, b) =>
            b.totalCalls - a.totalCalls ||
            b.answeredCalls - a.answeredCalls ||
            a.agentName.localeCompare(b.agentName),
        )
    );
  }
}
