import { Injectable, NotFoundException } from '@nestjs/common';
import { CallDirection, CallOutcome, Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { escapeLike } from '../leads/lead-search';
import { leadScopeWhere } from '../leads/lead-scope';
import { callScopeWhere } from './call-scope';
import { resolvePeriod } from './call-period';
import { CallLogQueryDto } from './dto/call-log-query.dto';

/**
 * One row of the Recent Call Log (CALL-05.1). The backlog fields, plus the
 * lead-derived columns the Workpex Manage Columns panel offers (source, stage,
 * assignee, tags) and the row's own audio/flag state. All of it comes off the
 * one scoped call read — no second round trip per row.
 */
export type CallLogRow = {
  id: string;
  /** The drill-through target for CALL-05.2 (clicking the Lead Name). */
  leadId: string;
  leadName: string;
  phone: string;
  startedAt: Date;
  outcome: CallOutcome;
  /** The inbound/outbound indicator (AC2). */
  direction: CallDirection;
  leadStatus: string;
  /** The lead's next outstanding follow-up due date, or null. */
  nextFollowUp: Date | null;
  leadNotes: string | null;
  callNotes: string | null;
  /** The PBX recording, when one exists — the Audio Clip column / download action. */
  audioUrl: string | null;
  /** The row's own flag, toggled from the Actions column. */
  flagged: boolean;
  /** The lead's origin channel, for the optional Lead Source column. */
  leadSource: string | null;
  /** The lead's pipeline — with `leadStatus`, the Lead Stage column. */
  leadPipeline: string;
  /** The lead's assigned agents, for the optional Assigned To column. */
  assignedTo: { id: string; name: string }[];
  /** The lead's tags, for the optional Tags column. */
  tags: { id: string; name: string }[];
};

export type CallLogResponse = {
  rows: CallLogRow[];
  total: number;
  page: number;
  size: number;
};

const CALL_LOG_SELECT = {
  id: true,
  leadId: true,
  phone: true,
  startedAt: true,
  outcome: true,
  direction: true,
  leadNotes: true,
  callNotes: true,
  audioUrl: true,
  flagged: true,
  lead: {
    select: {
      name: true,
      status: true,
      source: true,
      pipeline: true,
      assignments: { select: { user: { select: { id: true, name: true } } } },
      tags: { select: { tag: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.CallSelect;

/**
 * The Recent Call Log (CALL-05.1): a scoped, paginated, chronological list of
 * individual calls behind the summary KPIs. Reuses `callScopeWhere` and
 * `resolvePeriod`, and the leads' `escapeLike` for search. Server-side paged
 * (CLAUDE §8 — never an unbounded log). Outcome + name/number search are the
 * only filters here; the rest are CALL-06.1.
 */
@Injectable()
export class CallLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getLog(query: CallLogQueryDto): Promise<CallLogResponse> {
    const user = await this.currentUser.resolve();
    const { start, end } = resolvePeriod(query);

    const where: Prisma.CallWhereInput = {
      ...callScopeWhere(user),
      startedAt: { gte: start, lt: end },
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.agentId ? { agentId: query.agentId } : {}),
      // "Show flagged calls only" — absent means both, never `flagged: false`.
      ...(query.flagged ? { flagged: true } : {}),
      ...this.searchWhere(query.search),
    };

    // Lead Status filter (CALL-06.1): narrow the scoped lead relation by status.
    // Merged into the scope's lead filter (not spread over it) so role scoping
    // still applies.
    if (query.leadStatus) {
      where.lead = { ...leadScopeWhere(user), status: query.leadStatus };
    }

    // Page and total in one transaction so a concurrent insert can't make the
    // count disagree with the page (the Leads findPage rule).
    const [calls, total] = await this.prisma.$transaction([
      this.prisma.call.findMany({
        where,
        select: CALL_LOG_SELECT,
        // Time Metric: the longest calls first when ordering by duration,
        // otherwise the chronological default (AC1). `startedAt` breaks ties so
        // the page order is stable either way.
        orderBy:
          query.timeMetric === 'CALL_DURATION'
            ? [{ duration: 'desc' as const }, { startedAt: 'desc' as const }]
            : [{ startedAt: 'desc' as const }],
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.call.count({ where }),
    ]);

    const nextFollowUpByLead = await this.nextFollowUps(
      calls.map((call) => call.leadId),
    );

    const rows = calls.map((call): CallLogRow => ({
      id: call.id,
      leadId: call.leadId,
      leadName: call.lead.name,
      phone: call.phone,
      startedAt: call.startedAt,
      outcome: call.outcome,
      direction: call.direction,
      leadStatus: call.lead.status,
      nextFollowUp: nextFollowUpByLead.get(call.leadId) ?? null,
      leadNotes: call.leadNotes,
      callNotes: call.callNotes,
      audioUrl: call.audioUrl,
      flagged: call.flagged,
      leadSource: call.lead.source,
      leadPipeline: call.lead.pipeline,
      assignedTo: call.lead.assignments.map((a) => a.user),
      tags: call.lead.tags.map((t) => t.tag),
    }));

    return { rows, total, page: query.page, size: query.size };
  }

  /**
   * Toggle one call's flag from the log's Actions column. Scoped like every read
   * here — the update is filtered by `callScopeWhere`, so an agent cannot flag a
   * call on someone else's lead by posting its id.
   */
  async setFlagged(
    id: string,
    flagged: boolean,
  ): Promise<{ flagged: boolean }> {
    const user = await this.currentUser.resolve();
    const { count } = await this.prisma.call.updateMany({
      where: { ...callScopeWhere(user), id },
      data: { flagged },
    });
    if (count === 0) throw new NotFoundException('Call not found');
    return { flagged };
  }

  /** Name-or-number search, reusing the leads LIKE-escape (AC4). */
  private searchWhere(search: string | undefined): Prisma.CallWhereInput {
    const term = search?.trim();
    if (!term) return {};
    const needle = escapeLike(term);
    return {
      OR: [
        { lead: { name: { contains: needle, mode: 'insensitive' } } },
        { phone: { contains: needle } },
      ],
    };
  }

  /**
   * The soonest outstanding follow-up per lead — the "Next Follow-up" column.
   * Follow-ups live in Activities (the ACT module); the earliest incomplete,
   * non-deleted activity is the next one due (overdue or upcoming).
   */
  private async nextFollowUps(
    leadIds: string[],
  ): Promise<Map<string, Date | null>> {
    if (leadIds.length === 0) return new Map();
    const groups = await this.prisma.activity.groupBy({
      by: ['leadId'],
      where: { leadId: { in: leadIds }, completedAt: null, deletedAt: null },
      _min: { dueAt: true },
    });
    return new Map(groups.map((group) => [group.leadId, group._min.dueAt]));
  }
}
