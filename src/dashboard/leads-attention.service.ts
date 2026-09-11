import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildLeadWhere } from '../leads/lead-where';
import { leadScopeWhere } from '../leads/lead-scope';
import { LOST_STATUS } from '../leads/lead-status.constants';
import { noRecentActivityWhere } from '../reports/no-activity-where';
import { buildOverdueFollowUpsWhere } from '../reports/overdue-follow-ups-where';
import { avatarUrlsByUser } from './dashboard-agents';
import { LeadsAttentionQueryDto } from './dto/leads-attention-query.dto';

/** The three at-risk buckets the widget offers (DASH-07.1 AC1). */
export const ATTENTION_GROUPS = ['overdue', 'noActivity', 'lost'] as const;
export type AttentionGroup = (typeof ATTENTION_GROUPS)[number];

export interface AttentionAgent {
  agentId: string;
  agentName: string;
  avatarUrl: string | null;
}

export interface AttentionRow {
  leadId: string;
  leadName: string;
  assignedAgents: AttentionAgent[];
  /** ISO instant; the client renders the reference's two-line date over time. */
  leadDateTime: string;
}

export interface LeadsAttentionResponse {
  counts: Record<AttentionGroup, number>;
  rows: AttentionRow[];
  /** Rows in the SELECTED group, role-scoped — the pager's denominator. */
  total: number;
}

const LEAD_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  assignments: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.LeadSelect;

/**
 * Leads needing attention (DASH-07.1).
 *
 * **Not one new business rule.** Each group is the module that already owns it:
 *
 *   • Overdue — `buildOverdueFollowUpsWhere`, the Overdue Follow Ups report's own
 *     predicate. It describes an *activity*, while this widget lists *leads*, so it
 *     is composed through the relation: a lead qualifies when it has some activity
 *     that predicate matches. That keeps one definition of "overdue" rather than a
 *     lead-shaped copy that could drift from the report and the KPI counter.
 *   • No Activity — `noRecentActivityWhere`, the No Activity Leads report's rule
 *     ("no completed activity and no logged call in the window").
 *   • Lost — `status = LOST` via `buildLeadWhere`, the approved definition the Lost
 *     Leads report re-exports.
 *
 * Role scope and soft-delete arrive inside those fragments, at the query, so an
 * agent's board can only ever hold their own leads and their own total (AC4).
 */
@Injectable()
export class LeadsAttentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly storage: StorageService,
  ) {}

  async getLeadsAttention(
    query: LeadsAttentionQueryDto,
  ): Promise<LeadsAttentionResponse> {
    const user = await this.currentUser.resolve();
    const wheres: Record<AttentionGroup, Prisma.LeadWhereInput> = {
      overdue: this.overdueWhere(user, query),
      noActivity: this.noActivityWhere(user, query),
      lost: this.lostWhere(user, query),
    };
    const selected = wheres[query.group];

    // All three counts plus the selected page and its total in ONE transaction:
    // the cards and the table are read in the same snapshot, so a card can never
    // disagree with the list it opens (the Leads findPage rule).
    const [overdue, noActivity, lost, rows, total] =
      await this.prisma.$transaction([
        this.prisma.lead.count({ where: wheres.overdue }),
        this.prisma.lead.count({ where: wheres.noActivity }),
        this.prisma.lead.count({ where: wheres.lost }),
        this.prisma.lead.findMany({
          where: selected,
          select: LEAD_SELECT,
          // Most recent first — the reference's own order, and `id` breaks ties so
          // a row never repeats or vanishes between pages.
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.lead.count({ where: selected }),
      ]);

    const avatars = await avatarUrlsByUser(this.prisma, this.storage, [
      ...new Set(
        rows.flatMap((lead) =>
          lead.assignments.map((assignment) => assignment.user.id),
        ),
      ),
    ]);

    return {
      counts: { overdue, noActivity, lost },
      total,
      rows: rows.map((lead) => ({
        leadId: lead.id,
        leadName: lead.name,
        assignedAgents: lead.assignments.map(({ user: agent }) => ({
          agentId: agent.id,
          agentName: agent.name,
          avatarUrl: avatars.get(agent.id) ?? null,
        })),
        // The column is "Lead Date/Time" and the No Activity group has, by
        // definition, no activity to date — so the lead's own instant is the only
        // one that can fill every row. DASH-07.1 AC2 words it "last activity
        // date/time"; that reading is reported, not silently adopted.
        leadDateTime: lead.createdAt.toISOString(),
      })),
    };
  }

  /** Leads carrying an overdue follow-up, via the report's own activity predicate. */
  private overdueWhere(
    user: CurrentUser,
    query: LeadsAttentionQueryDto,
  ): Prisma.LeadWhereInput {
    return {
      AND: [
        leadScopeWhere(user),
        {
          activities: {
            some: buildOverdueFollowUpsWhere(user, {
              todayStart: query.todayStart,
              from: query.from,
              to: query.to,
            }),
          },
        },
      ],
    };
  }

  /** Untouched leads, via the No Activity report's own predicate. */
  private noActivityWhere(
    user: CurrentUser,
    query: LeadsAttentionQueryDto,
  ): Prisma.LeadWhereInput {
    return {
      AND: [
        buildLeadWhere(user, {
          createdFrom: query.from,
          createdTo: query.to,
        }),
        noRecentActivityWhere({}),
      ],
    };
  }

  /** Closed-lost, via the approved status definition. */
  private lostWhere(
    user: CurrentUser,
    query: LeadsAttentionQueryDto,
  ): Prisma.LeadWhereInput {
    return buildLeadWhere(user, {
      status: [LOST_STATUS],
      createdFrom: query.from,
      createdTo: query.to,
    });
  }
}
