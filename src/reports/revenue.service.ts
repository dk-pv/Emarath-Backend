import { BadRequestException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { periodFilter } from '../dashboard/dashboard-agents';
import { targetMembersWhere } from '../dashboard/team-revenue.service';
import { toLeadListItem } from '../leads/dto/lead-response.dto';
import { LOST_STATUS } from '../leads/lead-status.constants';
import { buildLeadWhere } from '../leads/lead-where';
import { CONVERTED_STATUS } from './converted-leads-where';
import { CONVERTED_LIST_SELECT } from './dto/converted-leads-response.dto';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import type {
  RevenueDealsResponse,
  RevenueOverviewResponse,
} from './dto/revenue-response.dto';
import { fileStamp } from './report-pdf-parts';
import { revenuePdf } from './revenue-pdf';
import {
  buildPipelineRows,
  buildSourceRows,
  dealPage,
  figureChanges,
  orderDeals,
  periodTarget,
  revenueFigures,
  roleLabel,
  sourceLabel,
  sumTallies,
  tally,
  type DealLine,
  type DealOrder,
} from './revenue-report';

/** A ceiling on the deals one sorted read holds, in the spirit of the dashboard's `MAX_SCAN_ROWS`. */
export const MAX_DEALS = 50_000;

/** What the grid sorts and groups by; the page's own rows are read in full afterwards. */
const DEAL_LINE_SELECT = {
  id: true,
  name: true,
  pipeline: true,
  status: true,
  actualAmount: true,
  secondaryPhone: true,
  product: true,
  language: true,
  country: true,
  source: true,
  statusChangedAt: true,
} satisfies Prisma.LeadSelect;

const and = (
  ...conditions: Prisma.LeadWhereInput[]
): Prisma.LeadWhereInput => ({ AND: conditions });

/** Leads that moved to `status` inside the window (or ever, without one) and are in it now. */
function closedIn(
  leads: Prisma.LeadWhereInput,
  status: string,
  window: Prisma.DateTimeFilter | undefined,
): Prisma.LeadWhereInput {
  return and(leads, { status, ...(window ? { statusChangedAt: window } : {}) });
}

/** The trend's buckets from its ascending edges: n edges, n − 1 half-open buckets. */
function trendBuckets(edges: readonly string[] = []): [Date, Date][] {
  const dates = edges.map((edge) => new Date(edge));
  const buckets: [Date, Date][] = [];
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] <= dates[i - 1])
      throw new BadRequestException('edge values must ascend');
    buckets.push([dates[i - 1], dates[i]]);
  }
  return buckets;
}

/**
 * The Revenue Report (Analytics, ADR-0099 decision 15). Every read composes the leads module's
 * `buildLeadWhere` — role scope, pipeline access, soft delete — with the toolbar's Sales Agent,
 * Pipeline and Filter conditions, so the KPIs, the trend, both breakdowns, the Data Grid and the
 * export count the same deals and never one the caller cannot open. The figures' rules live in
 * `revenue-report.ts`.
 */
@Injectable()
export class RevenueReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** GET /reports/revenue — the Overview & Trend tab. Grouped in the database; no lead is loaded. */
  async overview(query: RevenueQueryDto): Promise<RevenueOverviewResponse> {
    const user = await this.currentUser.resolve();
    const leads = this.leadsWhere(user, query);
    const period = periodFilter(query);
    const prior =
      query.priorFrom || query.priorTo
        ? periodFilter({ from: query.priorFrom, to: query.priorTo })
        : null;
    const buckets = trendBuckets(query.edge);

    const won = (window: Prisma.DateTimeFilter | undefined) =>
      closedIn(leads, CONVERTED_STATUS, window);
    const created = (window: Prisma.DateTimeFilter | undefined) =>
      window ? and(leads, { createdAt: window }) : leads;
    const bySource = (where: Prisma.LeadWhereInput) =>
      this.prisma.lead
        .groupBy({
          by: ['source'],
          where,
          _count: { _all: true },
          _sum: { actualAmount: true },
        })
        .then((groups) =>
          tally(
            groups.map((group) => ({
              label: sourceLabel(group.source),
              count: group._count._all,
              amount: group._sum.actualAmount,
            })),
          ),
        );
    const byPipeline = (where: Prisma.LeadWhereInput) =>
      this.prisma.lead
        .groupBy({
          by: ['pipeline'],
          where,
          _count: { _all: true },
          _sum: { actualAmount: true },
        })
        .then((groups) =>
          tally(
            groups.map((group) => ({
              label: group.pipeline,
              count: group._count._all,
              amount: group._sum.actualAmount,
            })),
          ),
        );

    const [
      deals,
      priorDeals,
      cohort,
      cohortWon,
      priorCohort,
      priorCohortWon,
      goals,
      pipelineDeals,
      pipelineLost,
      trend,
    ] = await Promise.all([
      bySource(won(period)),
      prior === null ? null : bySource(won(prior)),
      bySource(created(period)),
      bySource(and(created(period), { status: CONVERTED_STATUS })),
      prior === null ? null : this.prisma.lead.count({ where: created(prior) }),
      prior === null
        ? null
        : this.prisma.lead.count({
            where: and(created(prior), { status: CONVERTED_STATUS }),
          }),
      this.prisma.user.aggregate({
        where: query.agent?.length
          ? { AND: [targetMembersWhere(user), { id: { in: query.agent } }] }
          : targetMembersWhere(user),
        _sum: { monthlyGoalAmount: true },
      }),
      byPipeline(won(period)),
      byPipeline(closedIn(leads, LOST_STATUS, period)),
      Promise.all(
        buckets.map(([from, to]) =>
          this.prisma.lead.aggregate({
            where: won({ gte: from, lt: to }),
            _count: true,
            _sum: { actualAmount: true },
          }),
        ),
      ),
    ]);

    const totals = sumTallies(deals);
    const current = revenueFigures(totals, {
      leads: sumTallies(cohort).count,
      won: sumTallies(cohortWon).count,
    });
    const before =
      priorDeals === null || priorCohort === null || priorCohortWon === null
        ? null
        : revenueFigures(sumTallies(priorDeals), {
            leads: priorCohort,
            won: priorCohortWon,
          });

    return {
      current,
      prior: before,
      change: figureChanges(current, before),
      // A target needs a period to measure; the whole months are the browser's count.
      target: periodTarget(
        goals._sum.monthlyGoalAmount,
        period ? query.targetMonths : undefined,
        totals.amount,
      ),
      trend: buckets.map(([from, to], index) => ({
        from: from.toISOString(),
        to: to.toISOString(),
        revenue: (
          trend[index]._sum.actualAmount ?? new Prisma.Decimal(0)
        ).toFixed(2),
        deals: trend[index]._count,
      })),
      sources: buildSourceRows({
        deals,
        prior: priorDeals,
        created: cohort,
        createdWon: cohortWon,
      }),
      pipelines: buildPipelineRows(pipelineDeals, pipelineLost),
    };
  }

  /**
   * GET /reports/revenue/deals — one page of the Data Grid. Sorting by Assigned and grouping by
   * agent or role order by a value no column holds (a deal's assignees together), so the window's
   * deals are read narrow, ordered and grouped here, and only the page's rows are read in full.
   */
  async deals(query: RevenueQueryDto): Promise<RevenueDealsResponse> {
    const user = await this.currentUser.resolve();
    const where = this.dealsWhere(user, query);
    const order = await this.orderedDeals(where, query);
    const page = dealPage(order, query.page, query.size);
    const ids = page.entries.map((entry) => entry.line.id);

    const [leads, won] = await Promise.all([
      this.prisma.lead.findMany({
        where: and(where, { id: { in: ids } }),
        select: CONVERTED_LIST_SELECT,
      }),
      // Every deal is WON: its colour is the first WON stage's, as the Converted Leads report
      // resolves a status's colour across pipelines.
      this.prisma.stage.findFirst({
        where: { name: CONVERTED_STATUS },
        orderBy: [{ pipeline: 'asc' }, { position: 'asc' }],
        select: { color: true },
      }),
    ]);
    const byId = new Map(leads.map((lead) => [lead.id, lead]));

    return {
      rows: page.entries.flatMap(({ line, group }) => {
        const lead = byId.get(line.id);
        return lead
          ? [
              {
                ...toLeadListItem(lead),
                statusColor: won?.color ?? null,
                convertedAt: lead.statusChangedAt.toISOString(),
                groupKey: group?.key ?? null,
              },
            ]
          : [];
      }),
      total: order.entries.length,
      groups: page.groups,
      truncated: order.truncated,
    };
  }

  /** GET /reports/revenue/export — the report as a PDF; resolves to the deals it lists. */
  async exportPdf(query: RevenueQueryDto, res: Response): Promise<number> {
    const user = await this.currentUser.resolve();
    const [report, order] = await Promise.all([
      this.overview(query),
      this.orderedDeals(this.dealsWhere(user, query), query, true),
    ]);
    const now = new Date();
    const { file, listed } = revenuePdf(report, order, {
      subtitle: query.subtitle || 'Revenue Report',
      labels: query.label ?? [],
      group: query.group ?? 'none',
      generatedAt: now,
    });
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="revenue-report-${fileStamp(now)}.pdf"`,
      )
      .end(file);
    return listed;
  }

  /** The toolbar's narrowing on top of the caller's scope. */
  private leadsWhere(
    user: CurrentUser,
    query: RevenueQueryDto,
  ): Prisma.LeadWhereInput {
    return buildLeadWhere(user, {
      pipeline: query.pipeline,
      assignedAgent: query.agent,
      conditions: query.conditions,
    });
  }

  /** The deals the Data Grid lists: the same leads the KPIs count. */
  private dealsWhere(
    user: CurrentUser,
    query: RevenueQueryDto,
  ): Prisma.LeadWhereInput {
    return closedIn(
      this.leadsWhere(user, query),
      CONVERTED_STATUS,
      periodFilter(query),
    );
  }

  /** The window's deals in grid order; newest first if more than `MAX_DEALS` must be cut. */
  private async orderedDeals(
    where: Prisma.LeadWhereInput,
    query: RevenueQueryDto,
    withAssignees = query.group === 'agent' ||
      query.group === 'role' ||
      query.sort === 'assigned',
  ): Promise<DealOrder> {
    const [rows, assignments] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: DEAL_LINE_SELECT,
        orderBy: [{ statusChangedAt: 'desc' }, { id: 'asc' }],
        take: MAX_DEALS + 1,
      }),
      withAssignees
        ? this.prisma.leadAssignment.findMany({
            where: { lead: where },
            select: {
              leadId: true,
              user: {
                select: {
                  name: true,
                  role: true,
                  orgRole: { select: { name: true } },
                },
              },
            },
          })
        : [],
    ]);
    const assignees = new Map<string, DealLine['assignees']>();
    for (const { leadId, user } of assignments) {
      assignees.set(leadId, [
        ...(assignees.get(leadId) ?? []),
        {
          name: user.name,
          role: roleLabel(user.role, user.orgRole?.name ?? null),
        },
      ]);
    }
    return orderDeals(
      rows
        .slice(0, MAX_DEALS)
        .map((row) => ({ ...row, assignees: assignees.get(row.id) ?? [] })),
      {
        group: query.group ?? 'none',
        sort: query.sort,
        direction: query.direction,
        truncated: rows.length > MAX_DEALS,
      },
    );
  }
}
