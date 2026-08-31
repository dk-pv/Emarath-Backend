import { Injectable } from '@nestjs/common';
import { CallOutcome, Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { callScopeWhere } from './call-scope';
import { resolvePeriod } from './call-period';
import { CallSummaryQueryDto } from './dto/call-summary-query.dto';

export type CountRow = { label: string; count: number };

export type CallAnalytics = {
  /** Call By Status — one row per PBX disposition, zeros included. */
  byStatus: CountRow[];
  /** Call Summary By Lead Source — the donut's slices. */
  bySource: CountRow[];
  /** Calls By Lead Stage — the lead's status, suffixed with its pipeline. */
  byStage: CountRow[];
  /** The donut's centre figure: every call in the window. */
  total: number;
};

/**
 * The Workpex "Call By Status" list. Our `CallOutcome` enum carries the three
 * dispositions 3CX actually reports through our ingestion contract; the other
 * three are PBX SIP dispositions the connector does not yet surface, so they are
 * listed at zero rather than dropped — the reference shows them at zero too.
 * Making them real needs an enum migration AND the live 3CX transport
 * (CALL-02.1), so inventing values here would fabricate call outcomes.
 */
const STATUS_ROWS: { label: string; outcome: CallOutcome | null }[] = [
  { label: 'ANSWERED', outcome: CallOutcome.ANSWERED },
  { label: 'BUSY', outcome: CallOutcome.BUSY },
  { label: 'NO ANSWER', outcome: CallOutcome.NO_ANSWER },
  { label: 'CONGESTION', outcome: null },
  { label: 'CHAN UN AVAIL', outcome: null },
  { label: 'CANCEL', outcome: null },
];

/**
 * The three analytics panels under the leaderboard: Call By Status, Call Summary
 * By Lead Source and Calls By Lead Stage. Every figure is an aggregate of the
 * same scoped call log the KPIs and the leaderboard read, over the same resolved
 * period, so the three panels can never disagree with the cards above them.
 *
 * Source and stage are the lead's own values (Workpex has no separate call
 * taxonomy), which is what keeps the donut's slices identical to the Lead Source
 * values on the Leads list.
 */
@Injectable()
export class CallAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getAnalytics(query: CallSummaryQueryDto): Promise<CallAnalytics> {
    const user = await this.currentUser.resolve();
    const { start, end } = resolvePeriod(query);
    const where: Prisma.CallWhereInput = {
      ...callScopeWhere(user),
      startedAt: { gte: start, lt: end },
      ...(query.agentId ? { agentId: query.agentId } : {}),
    };

    const [outcomes, leadGroups] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['outcome'],
        where,
        _count: { _all: true },
      }),
      // One row per contacted lead, carrying the call count — then folded by the
      // lead's source and stage below. Cheaper than two more grouped joins and
      // it guarantees both panels sum to the same total.
      this.prisma.call.groupBy({
        by: ['leadId'],
        where,
        _count: { _all: true },
      }),
    ]);

    const countByOutcome = new Map(
      outcomes.map((row) => [row.outcome, row._count._all]),
    );
    const byStatus = STATUS_ROWS.map(({ label, outcome }) => ({
      label,
      count: outcome ? (countByOutcome.get(outcome) ?? 0) : 0,
    }));

    const leads =
      leadGroups.length === 0
        ? []
        : await this.prisma.lead.findMany({
            where: { id: { in: leadGroups.map((row) => row.leadId) } },
            select: { id: true, source: true, status: true, pipeline: true },
          });
    const leadById = new Map(leads.map((lead) => [lead.id, lead]));

    const sourceTotals = new Map<string, number>();
    const stageTotals = new Map<string, number>();
    let total = 0;
    for (const group of leadGroups) {
      const lead = leadById.get(group.leadId);
      const count = group._count._all;
      total += count;
      const source = lead?.source?.trim() || 'Unknown';
      sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + count);
      // Workpex suffixes the stage with its pipeline's initials — "New (LP)",
      // "CANCELLED (LS)" — so two pipelines can share a stage name on one list.
      const stage = lead
        ? `${lead.status} (${initials(lead.pipeline)})`
        : 'Unknown';
      stageTotals.set(stage, (stageTotals.get(stage) ?? 0) + count);
    }

    return {
      byStatus,
      bySource: toRows(sourceTotals),
      byStage: toRows(stageTotals),
      total,
    };
  }
}

/** "Lead Pipeline" → "LP"; a single-word pipeline keeps its first two letters. */
function initials(pipeline: string): string {
  const words = pipeline.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '--';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map((word) => word[0]).join('').toUpperCase();
}

/** Highest count first, then alphabetical — a stable order across reloads. */
function toRows(totals: Map<string, number>): CountRow[] {
  return [...totals.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
