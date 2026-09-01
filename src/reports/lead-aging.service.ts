import { BadRequestException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildLeadAgingWhere } from './lead-aging-where';
import { LeadAgingQueryDto } from './dto/lead-aging-query.dto';
import {
  LEAD_AGING_SELECT,
  LeadAgingAgentRow,
  LeadAgingKpis,
  LeadAgingLeadRow,
  LeadAgingListResponse,
  LeadAgingSummaryResponse,
  LeadHealth,
} from './dto/lead-aging-response.dto';

const BATCH_SIZE = 1000;
const MAX_ROWS = 100_000;
const EXPORT_BATCH_SIZE = 1000;
const DAY_MS = 86_400_000;
const UNASSIGNED_LABEL = 'Unassigned';

/**
 * The details columns the database can order directly. "Lead age ascending" is "created
 * descending" — the younger the lead, the later it was created — and the health band is
 * derived from age, so it orders by the same column.
 */
const DB_SORTS: Record<
  string,
  (direction: Prisma.SortOrder) => Prisma.LeadOrderByWithRelationInput
> = {
  name: (direction) => ({ name: direction }),
  stage: (direction) => ({ status: direction }),
  // Nullable columns pin their blanks last in BOTH directions — Postgres would otherwise
  // lead a descending sort with empty rows, and the computed sorts below park nulls last.
  source: (direction) => ({ source: { sort: direction, nulls: 'last' } }),
  amount: (direction) => ({ actualAmount: { sort: direction, nulls: 'last' } }),
  leadAge: (direction) => ({ createdAt: direction === 'asc' ? 'desc' : 'asc' }),
  status: (direction) => ({ createdAt: direction === 'asc' ? 'desc' : 'asc' }),
};

/**
 * The rest are computed per row — the owner's name, the assignment date and the two
 * activity spans — so they are ordered in app over the scoped set, not by the database.
 */
const COMPUTED_SORTS: Record<
  string,
  (row: LeadAgingLeadRow) => string | number | null
> = {
  owner: (row) => row.owner[0]?.name.toLowerCase() ?? null,
  ageAssignment: (row) => row.ageSinceAssignmentDays,
  daysSinceNoActivity: (row) => row.daysSinceNoActivity,
  lastActivity: (row) =>
    row.lastActivityAt ? Date.parse(row.lastActivityAt) : null,
};

/** Oldest first: an aging report's most useful default. */
const ORDER_BY: Prisma.LeadOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

const EXPORT_HEADERS = [
  'Lead Name',
  'Owner',
  'Stage',
  'Source',
  'Lead Age (days)',
  'Age / Assignment (days)',
  'Days Since No Activity',
  'Last Activity',
  'Amount',
  'Status',
] as const;

type AgingLead = Prisma.LeadGetPayload<{ select: typeof LEAD_AGING_SELECT }>;

/** Whole days between two instants, floored and never negative. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** The mean of a list, to one decimal; 0 for an empty list. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

/**
 * The Lead Aging & Stale Leads report (RPT-02.8).
 *
 * Two questions in one report: how OLD a lead is (age since it was created, and since it
 * was assigned) and how STALE it is (days since anyone last worked it — the last completed
 * activity or logged call, the same engagement signal the No Activity and Today Leads
 * reports use). Every read composes the one scoped `where`, so the cards, the agent
 * breakdown, the details table and the export always describe the same set of leads.
 *
 * The health bands come from the caller's thresholds (Green ≤ green, Amber ≤ amber, Red
 * beyond), so the server buckets exactly what the toolbar shows.
 */
@Injectable()
export class LeadAgingReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /**
   * The bands must not overlap or invert — a cross-field rule the DTO's per-field
   * decorators cannot express, so every read asserts it before querying.
   */
  private assertThresholds(query: LeadAgingQueryDto): void {
    if (query.amber <= query.green) {
      throw new BadRequestException('amber must be greater than green.');
    }
  }

  /** The metric cards and the per-agent breakdown, over the whole scoped set. */
  async summary(query: LeadAgingQueryDto): Promise<LeadAgingSummaryResponse> {
    this.assertThresholds(query);
    const user = await this.currentUser.resolve();
    const where = buildLeadAgingWhere(user, query);
    const now = new Date();

    const lastEngagement = await this.lastEngagementByLead(where);

    // ponytail: the aggregate walks the scoped leads in batches because the age bands and
    // the "days since activity" mean are computed values Prisma cannot group by. The
    // projection is tiny (dates + assignee ids) and capped; swap in a scoped raw query if
    // the tracked set ever outgrows MAX_ROWS.
    const ages: number[] = [];
    const perAgent = new Map<
      string | null,
      {
        name: string;
        green: number;
        amber: number;
        red: number;
        ages: number[];
        sinceAssignment: number[];
        sinceActivity: number[];
        noActivityEver: number;
      }
    >();
    let totalTracked = 0;
    let healthy = 0;
    let needsAttention = 0;
    let stale = 0;
    let noActivityEver = 0;
    let skip = 0;

    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: LEAD_AGING_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: BATCH_SIZE,
      });
      if (leads.length === 0) break;

      for (const lead of leads) {
        const age = daysBetween(lead.createdAt, now);
        const health = this.healthOf(age, query);
        const engaged = lastEngagement.get(lead.id) ?? null;
        const sinceActivity = engaged ? daysBetween(engaged, now) : age;
        const assignedAt = latestAssignment(lead);
        const sinceAssignment = assignedAt
          ? daysBetween(assignedAt, now)
          : null;

        totalTracked += 1;
        ages.push(age);
        if (health === 'healthy') healthy += 1;
        else if (health === 'attention') needsAttention += 1;
        else stale += 1;
        if (!engaged) noActivityEver += 1;

        // A co-assigned lead counts for each of its assignees, as every per-agent report
        // in the module does; an unassigned lead forms the "Unassigned" bucket.
        const owners: { id: string | null; name: string }[] =
          lead.assignments.length > 0
            ? lead.assignments.map((assignment) => ({
                id: assignment.user.id,
                name: assignment.user.name,
              }))
            : [{ id: null, name: UNASSIGNED_LABEL }];

        for (const owner of owners) {
          const bucket = perAgent.get(owner.id) ?? {
            name: owner.name,
            green: 0,
            amber: 0,
            red: 0,
            ages: [],
            sinceAssignment: [],
            sinceActivity: [],
            noActivityEver: 0,
          };
          if (health === 'healthy') bucket.green += 1;
          else if (health === 'attention') bucket.amber += 1;
          else bucket.red += 1;
          bucket.ages.push(age);
          if (sinceAssignment !== null)
            bucket.sinceAssignment.push(sinceAssignment);
          bucket.sinceActivity.push(sinceActivity);
          if (!engaged) bucket.noActivityEver += 1;
          perAgent.set(owner.id, bucket);
        }
      }

      if (leads.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }

    const kpis: LeadAgingKpis = {
      totalTracked,
      stale,
      needsAttention,
      healthy,
      avgLeadAgeDays: mean(ages),
      noActivityEver,
    };

    const agents: LeadAgingAgentRow[] = [...perAgent.entries()]
      .map(([agentId, bucket]) => ({
        agentId,
        agentName: bucket.name,
        green: bucket.green,
        amber: bucket.amber,
        red: bucket.red,
        total: bucket.green + bucket.amber + bucket.red,
        avgLeadAgeDays: mean(bucket.ages),
        avgAgeSinceAssignmentDays:
          bucket.sinceAssignment.length > 0
            ? mean(bucket.sinceAssignment)
            : null,
        avgDaysSinceActivityDays: mean(bucket.sinceActivity),
        noActivityEver: bucket.noActivityEver,
      }))
      // Oldest books of business first — the reference's reading order.
      .sort(
        (a, b) =>
          b.avgLeadAgeDays - a.avgLeadAgeDays ||
          a.agentName.localeCompare(b.agentName),
      );

    return { kpis, agents };
  }

  /** One scoped page of leads with their computed ages (the details table). */
  async listDetailed(query: LeadAgingQueryDto): Promise<LeadAgingListResponse> {
    this.assertThresholds(query);
    const user = await this.currentUser.resolve();
    const where = buildLeadAgingWhere(user, query);
    const now = new Date();
    const direction: Prisma.SortOrder =
      query.direction === 'desc' ? 'desc' : 'asc';
    const computed = query.sort ? COMPUTED_SORTS[query.sort] : undefined;

    // A computed column (owner, assignment age, activity spans) has no column to order
    // by, so the whole scoped set is built and ordered here before the page is cut —
    // otherwise a sort would only reshuffle the rows already on screen.
    // ponytail: bounded by MAX_ROWS, the same walk the summary makes; swap in a scoped
    // raw query if the tracked set ever outgrows it.
    if (computed) {
      const all = await this.allRows(where, now, query);
      const sign = direction === 'asc' ? 1 : -1;
      all.sort((a, b) => {
        const left = computed(a);
        const right = computed(b);
        // Rows with nothing to compare (never assigned, never worked) park last in both
        // directions rather than reading as zero.
        if (left === null || right === null) {
          return left === right ? 0 : left === null ? 1 : -1;
        }
        const order =
          typeof left === 'string' && typeof right === 'string'
            ? left.localeCompare(right)
            : Number(left) - Number(right);
        return order * sign || a.name.localeCompare(b.name);
      });
      const start = (query.page - 1) * query.size;
      return { rows: all.slice(start, start + query.size), total: all.length };
    }

    const orderBy =
      query.sort && DB_SORTS[query.sort]
        ? [DB_SORTS[query.sort](direction), { id: 'asc' as const }]
        : ORDER_BY;

    // Page + count in one transaction so `total` can never describe a different snapshot
    // than `rows`.
    const [[leads, total], colorByStage] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          select: LEAD_AGING_SELECT,
          orderBy,
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.lead.count({ where }),
      ]),
      this.stageColorByName(),
    ]);

    const lastEngagement = await this.lastEngagementByLead({
      id: { in: leads.map((lead) => lead.id) },
    });

    return {
      rows: leads.map((lead) =>
        this.toRow(
          lead,
          now,
          lastEngagement.get(lead.id) ?? null,
          query,
          colorByStage,
        ),
      ),
      total,
    };
  }

  /** Every scoped lead as a details row — the computed-sort path's input. */
  private async allRows(
    where: Prisma.LeadWhereInput,
    now: Date,
    query: LeadAgingQueryDto,
  ): Promise<LeadAgingLeadRow[]> {
    const [lastEngagement, colorByStage] = await Promise.all([
      this.lastEngagementByLead(where),
      this.stageColorByName(),
    ]);

    const rows: LeadAgingLeadRow[] = [];
    let skip = 0;
    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: LEAD_AGING_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: BATCH_SIZE,
      });
      if (leads.length === 0) break;
      for (const lead of leads) {
        rows.push(
          this.toRow(
            lead,
            now,
            lastEngagement.get(lead.id) ?? null,
            query,
            colorByStage,
          ),
        );
      }
      if (leads.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }
    return rows;
  }

  /** Streams the scoped leads to a CSV download; the same `where` the tables compose. */
  async exportCsv(query: LeadAgingQueryDto, res: Response): Promise<void> {
    this.assertThresholds(query);
    const user = await this.currentUser.resolve();
    const where = buildLeadAgingWhere(user, query);
    const now = new Date();
    const colorByStage = await this.stageColorByName();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename()}"`,
    );
    res.write('﻿');
    res.write(
      EXPORT_HEADERS.map((header) => csvCell(header)).join(',') + '\r\n',
    );

    let skip = 0;
    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: LEAD_AGING_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: EXPORT_BATCH_SIZE,
      });
      if (leads.length === 0) break;

      const lastEngagement = await this.lastEngagementByLead({
        id: { in: leads.map((lead) => lead.id) },
      });
      let chunk = '';
      for (const lead of leads) {
        const row = this.toRow(
          lead,
          now,
          lastEngagement.get(lead.id) ?? null,
          query,
          colorByStage,
        );
        chunk +=
          [
            csvCell(row.name),
            csvCell(row.owner.map((owner) => owner.name).join('; ')),
            csvCell(row.stage),
            csvCell(row.source ?? ''),
            csvCell(String(row.leadAgeDays)),
            csvCell(
              row.ageSinceAssignmentDays === null
                ? ''
                : String(row.ageSinceAssignmentDays),
            ),
            csvCell(String(row.daysSinceNoActivity)),
            csvCell(row.lastActivityAt ?? 'Never'),
            csvCell(row.amount ?? ''),
            csvCell(row.health),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (leads.length < EXPORT_BATCH_SIZE) break;
      skip += EXPORT_BATCH_SIZE;
    }
    res.end();
  }

  private toRow(
    lead: AgingLead,
    now: Date,
    engaged: Date | null,
    query: LeadAgingQueryDto,
    colorByStage: Map<string, string>,
  ): LeadAgingLeadRow {
    const leadAgeDays = daysBetween(lead.createdAt, now);
    const assignedAt = latestAssignment(lead);
    return {
      id: lead.id,
      name: lead.name,
      owner: lead.assignments.map((assignment) => ({
        id: assignment.user.id,
        name: assignment.user.name,
      })),
      stage: lead.status,
      stageColor: colorByStage.get(lead.status) ?? null,
      source: lead.source,
      leadAgeDays,
      ageSinceAssignmentDays: assignedAt ? daysBetween(assignedAt, now) : null,
      daysSinceNoActivity: engaged ? daysBetween(engaged, now) : leadAgeDays,
      lastActivityAt: engaged ? engaged.toISOString() : null,
      amount: lead.actualAmount?.toString() ?? null,
      health: this.healthOf(leadAgeDays, query),
    };
  }

  /** Which band an age falls in, given the caller's thresholds. */
  private healthOf(ageDays: number, query: LeadAgingQueryDto): LeadHealth {
    if (ageDays <= query.green) return 'healthy';
    if (ageDays <= query.amber) return 'attention';
    return 'stale';
  }

  /**
   * The last time anyone worked each lead — the later of its last completed activity and
   * its last logged call, in two `groupBy`s (never a query per lead). Leads nobody has
   * worked are simply absent, which the callers read as "Never".
   */
  private async lastEngagementByLead(
    lead: Prisma.LeadWhereInput,
  ): Promise<Map<string, Date>> {
    const [activities, calls] = await Promise.all([
      this.prisma.activity.groupBy({
        by: ['leadId'],
        where: { lead, deletedAt: null, completedAt: { not: null } },
        _max: { completedAt: true },
      }),
      this.prisma.call.groupBy({
        by: ['leadId'],
        where: { lead, deletedAt: null },
        _max: { startedAt: true },
      }),
    ]);

    const last = new Map<string, Date>();
    const note = (leadId: string, at: Date | null) => {
      if (!at) return;
      const current = last.get(leadId);
      if (!current || at > current) last.set(leadId, at);
    };
    for (const group of activities) note(group.leadId, group._max.completedAt);
    for (const group of calls) note(group.leadId, group._max.startedAt);
    return last;
  }

  /** Stage colour by status name — the first stage carrying a name wins across pipelines. */
  private async stageColorByName(): Promise<Map<string, string>> {
    const stages = await this.prisma.stage.findMany({
      select: { name: true, color: true },
      orderBy: [{ pipeline: 'asc' }, { position: 'asc' }],
    });
    const map = new Map<string, string>();
    for (const stage of stages) {
      if (!map.has(stage.name)) map.set(stage.name, stage.color);
    }
    return map;
  }
}

/** The latest assignment's instant — the one in force when a lead has several. */
function latestAssignment(lead: AgingLead): Date | null {
  return lead.assignments.reduce<Date | null>(
    (latest, assignment) =>
      latest === null || assignment.createdAt > latest
        ? assignment.createdAt
        : latest,
    null,
  );
}

/** A timestamped, download-safe name: `lead-aging-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `lead-aging-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
}
