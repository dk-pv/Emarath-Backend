import { Injectable } from '@nestjs/common';
import { CallDirection, CallOutcome, Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { escapeLike } from '../leads/lead-search';
import { leadScopeWhere } from '../leads/lead-scope';
import { callScopeWhere } from './call-scope';
import { resolvePeriod } from './call-period';
import { CallLogQueryDto } from './dto/call-log-query.dto';

/** One row of the Recent Call Log (CALL-05.1) — the backlog fields, no more. */
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
  lead: { select: { name: true, status: true } },
} satisfies Prisma.CallSelect;

/**
 * The Recent Call Log (CALL-05.1): a scoped, paginated, chronological list of
 * individual calls behind the summary KPIs. Reuses `callScopeWhere` and
 * `resolvePeriod`, and the leads' `escapeLike` for search. Server-side paged
 * (CLAUDE §8 — never an unbounded log). Outcome + name/number search are the
 * only filters here; the rest are CALL-06.1. Audio Clip and the row Actions are
 * deferred (approved Change Request).
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
        orderBy: { startedAt: 'desc' }, // chronological, most recent first (AC1)
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
    }));

    return { rows, total, page: query.page, size: query.size };
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
