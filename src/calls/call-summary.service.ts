import { Injectable } from '@nestjs/common';
import {
  ActivityType,
  CallDirection,
  CallOutcome,
  Prisma,
} from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { leadScopeWhere } from '../leads/lead-scope';
import { callScopeWhere } from './call-scope';
import { callConnectPct } from './call-connect';
import { resolvePeriod } from './call-period';
import { CallSummaryQueryDto } from './dto/call-summary-query.dto';

/** One KPI: its value for the period and the day-over-day change (AC2). */
export type Kpi = {
  value: number;
  /** % change vs the preceding period of equal length; null when that was 0. */
  changePct: number | null;
};

/**
 * The Call summary KPIs. The first six are CALL-03.1 AC1; the remaining five are
 * the rest of the Workpex Summary carousel, added on the owner's ruling of
 * 2026-08-29. Their definitions are NOT in the backlog and were set with that
 * ruling — each is documented at its computation below so a wrong rule is
 * visible and correctable rather than buried.
 */
export type CallSummary = {
  freshCalls: Kpi;
  followUpCallsCompleted: Kpi;
  totalCalls: Kpi;
  uniqueCalls: Kpi;
  totalCallMinutes: Kpi;
  averageCallTime: Kpi;
  callConnectPct: Kpi;
  outboundCalls: Kpi;
  inboundCalls: Kpi;
  missedCalls: Kpi;
  abandonedCalls: Kpi;
};

type Metrics = {
  fresh: number;
  followUpCompleted: number;
  total: number;
  unique: number;
  minutes: number;
  average: number;
  connectPct: number;
  outbound: number;
  inbound: number;
  missed: number;
  abandoned: number;
};

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Day-level Call summary KPIs (CALL-03.1), covering the full Workpex carousel.
 * Each metric aggregates the scoped call log for the period and carries a
 * day-over-day change against the preceding period of equal length. `agentId`
 * narrows every figure to one agent — the Filter popup's "Select User" leg —
 * and is applied on top of role scoping, never instead of it.
 */
@Injectable()
export class CallSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getSummary(query: CallSummaryQueryDto): Promise<CallSummary> {
    const user = await this.currentUser.resolve();
    const scope: Prisma.CallWhereInput = {
      ...callScopeWhere(user),
      ...(query.agentId ? { agentId: query.agentId } : {}),
    };

    const { start, end } = resolvePeriod(query);
    const previousStart = new Date(
      start.getTime() - (end.getTime() - start.getTime()),
    );

    const [current, previous] = await Promise.all([
      this.metrics(scope, user, query.agentId, start, end),
      this.metrics(scope, user, query.agentId, previousStart, start),
    ]);

    return {
      freshCalls: kpi(current.fresh, previous.fresh),
      followUpCallsCompleted: kpi(
        current.followUpCompleted,
        previous.followUpCompleted,
      ),
      totalCalls: kpi(current.total, previous.total),
      uniqueCalls: kpi(current.unique, previous.unique),
      totalCallMinutes: kpi(current.minutes, previous.minutes),
      averageCallTime: kpi(current.average, previous.average),
      callConnectPct: kpi(current.connectPct, previous.connectPct),
      outboundCalls: kpi(current.outbound, previous.outbound),
      inboundCalls: kpi(current.inbound, previous.inbound),
      missedCalls: kpi(current.missed, previous.missed),
      abandonedCalls: kpi(current.abandoned, previous.abandoned),
    };
  }

  private async metrics(
    scope: Prisma.CallWhereInput,
    user: CurrentUser,
    agentId: string | undefined,
    start: Date,
    end: Date,
  ): Promise<Metrics> {
    const where: Prisma.CallWhereInput = {
      ...scope,
      startedAt: { gte: start, lt: end },
    };
    const inbound: Prisma.CallWhereInput = {
      ...where,
      direction: CallDirection.INBOUND,
    };

    const [
      total,
      answered,
      outbound,
      inboundCount,
      missed,
      abandoned,
      durationAgg,
      uniqueContacts,
      followUpCompleted,
    ] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.count({
        where: { ...where, outcome: CallOutcome.ANSWERED },
      }),
      this.prisma.call.count({
        where: { ...where, direction: CallDirection.OUTBOUND },
      }),
      this.prisma.call.count({ where: inbound }),
      // Missed = an inbound call that was not answered — the same rule the
      // leaderboard's Missed Calls column uses, so the two never disagree.
      this.prisma.call.count({
        where: { ...inbound, outcome: { not: CallOutcome.ANSWERED } },
      }),
      // Abandoned = a missed inbound that never connected at all (zero talk
      // time): the caller hung up before pickup. A strict subset of Missed.
      this.prisma.call.count({
        where: {
          ...inbound,
          outcome: { not: CallOutcome.ANSWERED },
          duration: 0,
        },
      }),
      this.prisma.call.aggregate({ where, _sum: { duration: true } }),
      // ponytail: loads one row per distinct contact — fine at day scale;
      // swap for a raw COUNT(DISTINCT) if a period ever spans huge volume.
      this.prisma.call.groupBy({ by: ['leadId'], where }),
      // Follow-up Calls Completed = scheduled CALL follow-ups that were marked
      // complete inside the period. Counted from Activities, not from the call
      // log, because a follow-up is completed by the agent, not by the PBX.
      this.prisma.activity.count({
        where: {
          deletedAt: null,
          type: ActivityType.CALL,
          completedAt: { gte: start, lt: end },
          lead: leadScopeWhere(user),
          ...(agentId ? { assignees: { some: { userId: agentId } } } : {}),
        },
      }),
    ]);

    const fresh = await this.freshCalls(where, start);
    const minutes = (durationAgg._sum.duration ?? 0) / 60;

    return {
      fresh,
      followUpCompleted,
      total,
      unique: uniqueContacts.length,
      minutes: round(minutes, 2),
      // Average talk time per connected call (Workpex: 22.60 min ÷ 9 answered ≈ 2.50).
      average: answered > 0 ? round(minutes / answered, 2) : 0,
      // The one shared Connect % computation (CALL-07.1).
      connectPct: callConnectPct(answered, total),
      outbound,
      inbound: inboundCount,
      missed,
      abandoned,
    };
  }

  /**
   * Fresh Calls = contacts called for the FIRST time in this period — a lead
   * with no call on record before the window opened. Distinct-contact based, so
   * three attempts on one new lead is one fresh call, not three.
   */
  private async freshCalls(
    where: Prisma.CallWhereInput,
    start: Date,
  ): Promise<number> {
    const contacted = await this.prisma.call.groupBy({ by: ['leadId'], where });
    if (contacted.length === 0) return 0;
    const leadIds = contacted.map((row) => row.leadId);
    const seenBefore = await this.prisma.call.groupBy({
      by: ['leadId'],
      where: { deletedAt: null, leadId: { in: leadIds }, startedAt: { lt: start } },
    });
    return leadIds.length - seenBefore.length;
  }
}

function kpi(current: number, previous: number): Kpi {
  const changePct =
    previous === 0 ? null : round(((current - previous) / previous) * 100, 1);
  return { value: current, changePct };
}
