import { Injectable } from '@nestjs/common';
import { CallDirection, CallOutcome, Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
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

/** The six Call summary KPIs (CALL-03.1 AC1) — no more, no less. */
export type CallSummary = {
  totalCalls: Kpi;
  uniqueCalls: Kpi;
  totalCallMinutes: Kpi;
  averageCallTime: Kpi;
  callConnectPct: Kpi;
  outboundCalls: Kpi;
};

type Metrics = {
  total: number;
  unique: number;
  minutes: number;
  average: number;
  connectPct: number;
  outbound: number;
};

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Day-level Call summary KPIs (CALL-03.1). Returns exactly the six metrics the
 * backlog defines — the video's extra Inbound/Missed/Abandoned cards are
 * deferred (approved Change Request). Each metric aggregates the scoped call log
 * for the period and carries a day-over-day change against the preceding period
 * of equal length. Injects PrismaService + CurrentUserService directly, like
 * the CALL-02.2 lookup; no repository.
 */
@Injectable()
export class CallSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getSummary(query: CallSummaryQueryDto): Promise<CallSummary> {
    const user = await this.currentUser.resolve();
    const scope = callScopeWhere(user);

    const { start, end } = resolvePeriod(query);
    const previousStart = new Date(
      start.getTime() - (end.getTime() - start.getTime()),
    );

    const [current, previous] = await Promise.all([
      this.metrics(scope, start, end),
      this.metrics(scope, previousStart, start),
    ]);

    return {
      totalCalls: kpi(current.total, previous.total),
      uniqueCalls: kpi(current.unique, previous.unique),
      totalCallMinutes: kpi(current.minutes, previous.minutes),
      averageCallTime: kpi(current.average, previous.average),
      callConnectPct: kpi(current.connectPct, previous.connectPct),
      outboundCalls: kpi(current.outbound, previous.outbound),
    };
  }

  private async metrics(
    scope: Prisma.CallWhereInput,
    start: Date,
    end: Date,
  ): Promise<Metrics> {
    const where: Prisma.CallWhereInput = {
      ...scope,
      startedAt: { gte: start, lt: end },
    };

    const [total, answered, outbound, durationAgg, uniqueContacts] =
      await Promise.all([
        this.prisma.call.count({ where }),
        this.prisma.call.count({
          where: { ...where, outcome: CallOutcome.ANSWERED },
        }),
        this.prisma.call.count({
          where: { ...where, direction: CallDirection.OUTBOUND },
        }),
        this.prisma.call.aggregate({ where, _sum: { duration: true } }),
        // ponytail: loads one row per distinct contact — fine at day scale;
        // swap for a raw COUNT(DISTINCT) if a period ever spans huge volume.
        this.prisma.call.groupBy({ by: ['leadId'], where }),
      ]);

    const minutes = (durationAgg._sum.duration ?? 0) / 60;

    return {
      total,
      unique: uniqueContacts.length,
      minutes: round(minutes, 2),
      // Average talk time per connected call (Workpex: 22.60 min ÷ 9 answered ≈ 2.50).
      average: answered > 0 ? round(minutes / answered, 2) : 0,
      // The one shared Connect % computation (CALL-07.1).
      connectPct: callConnectPct(answered, total),
      outbound,
    };
  }
}

function kpi(current: number, previous: number): Kpi {
  const changePct =
    previous === 0 ? null : round(((current - previous) / previous) * 100, 1);
  return { value: current, changePct };
}
