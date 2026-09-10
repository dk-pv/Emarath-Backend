import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { avatarUrlsByUser } from './dashboard-agents';
import { hotLeadsWhere } from './dashboard-kpis';
import { HotLeadsQueryDto } from './dto/hot-leads-query.dto';

const ZERO = new Prisma.Decimal(0);

/** One assignee of a hot lead. A lead carries 0..n of them (`LeadAssignment`). */
export interface HotLeadAgent {
  agentId: string;
  agentName: string;
  avatarUrl: string | null;
}

/**
 * One row of the Hot Leads widget (DASH-08.1). `value` is a decimal string, never a
 * number (money rule), and `null` — not `'0'` — when the lead carries no amount, so
 * the table can dash it rather than claim a zero-value lead.
 */
export interface HotLeadRow {
  leadId: string;
  leadName: string;
  assignedAgents: HotLeadAgent[];
  value: string | null;
}

export interface HotLeadsResponse {
  rows: HotLeadRow[];
  total: number;
  /**
   * Σ Lead Value over **every** hot lead in the period, not this page's (AC3) — an
   * aggregate over the same `where`, so turning the page never moves it.
   */
  totalValue: string;
}

/** Ranked by value (AC1); `id` breaks ties so a row never repeats or vanishes across pages. */
const ORDER_BY: Prisma.LeadOrderByWithRelationInput[] = [
  // NULLs sort first under Postgres DESC, which would head the table with the
  // valueless leads — the opposite of "ranked by value".
  { actualAmount: { sort: 'desc', nulls: 'last' } },
  { id: 'asc' },
];

const HOT_LEAD_SELECT = {
  id: true,
  name: true,
  actualAmount: true,
  assignments: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.LeadSelect;

/**
 * The Dashboard's Hot Leads widget (DASH-08.1).
 *
 * "Hot" is `HOT_LEAD_STATUSES` composed through `hotLeadsWhere` — the same fragment
 * the Hot Leads KPI counter uses, so the card's number and this table's `total` can
 * never disagree. Role scope, soft-delete and the createdAt period all arrive inside
 * that fragment, at the query, so an agent's table can only ever hold their own leads.
 *
 * **"Lead Value" is `actualAmount`.** The approved money field: the Converted Leads
 * report (RPT-02.6) sums it, the Leads By Ownership report labels Σ actualAmount
 * "Total Lead Value", and the Kanban sort maps "Lead Value" onto it. `forecastedAmount`
 * would be the tempting pick for a not-yet-won lead, but it is optional on the New Lead
 * drawer where Actual Amount is required, so it is blank on most rows and would rank
 * the table by whichever leads happened to carry a forecast. One frontend sort list
 * (`lead-sort-fields.ts`) maps "Lead Value" to `forecastedAmount` and is flagged there
 * for PO confirmation — that disagreement is reported, not resolved here.
 */
@Injectable()
export class HotLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly storage: StorageService,
  ) {}

  async getHotLeads(query: HotLeadsQueryDto): Promise<HotLeadsResponse> {
    const user = await this.currentUser.resolve();
    const where = hotLeadsWhere(user, query);

    // Page, count and running total in one transaction (the Leads findPage rule), so
    // `total` and `totalValue` can never describe a different snapshot than `rows`.
    const [leads, total, totals] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: HOT_LEAD_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.aggregate({ where, _sum: { actualAmount: true } }),
    ]);

    const avatars = await avatarUrlsByUser(this.prisma, this.storage, [
      ...new Set(
        leads.flatMap((lead) =>
          lead.assignments.map((assignment) => assignment.user.id),
        ),
      ),
    ]);

    return {
      rows: leads.map((lead) => ({
        leadId: lead.id,
        leadName: lead.name,
        assignedAgents: lead.assignments.map(({ user: agent }) => ({
          agentId: agent.id,
          agentName: agent.name,
          avatarUrl: avatars.get(agent.id) ?? null,
        })),
        value: lead.actualAmount?.toString() ?? null,
      })),
      total,
      totalValue: (totals._sum.actualAmount ?? ZERO).toString(),
    };
  }
}
