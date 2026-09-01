import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  LEAD_LIST_SELECT,
  toLeadListItem,
} from '../leads/dto/lead-response.dto';
import { csvCell } from '../leads/export/leads-export.columns';
import {
  answeredCallWhere,
  noEngagementWhere,
} from '../leads/lead-engagement-where';
import { CONVERTED_STATUS } from './converted-leads-where';
import { LOST_STATUS } from './lost-leads-where';
import { buildLeadsByOwnershipWhere } from './leads-by-ownership-where';
import { LeadsByOwnershipQueryDto } from './dto/leads-by-ownership-query.dto';
import {
  LEADS_BY_OWNERSHIP_SELECT,
  LeadsByOwnershipFilterOptions,
  LeadsByOwnershipListResponse,
  LeadsByOwnershipSummaryResponse,
  OwnerCountRow,
  UNASSIGNED_LABEL,
} from './dto/leads-by-ownership-response.dto';

/** Rows are read in pages so a large export never loads the whole set at once. */
const EXPORT_BATCH_SIZE = 1000;
/** A hard ceiling so a runaway filter cannot stream unbounded rows. */
const MAX_EXPORT_ROWS = 100_000;

/** id breaks ties so a row never repeats or vanishes across pages/batches. */
const ORDER_BY: Prisma.LeadOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

const EXPORT_HEADERS = [
  'Customer Name',
  'First Name',
  'Primary Phone',
  'Source',
  'Assigned',
] as const;

const ZERO = new Prisma.Decimal(0);

/** The stage a lead starts in; the ownership "New Leads" metric counts leads still there. */
const NEW_STATUS = 'New';

const METRIC_KEYS = [
  'newCount',
  'contactedCount',
  'noActivityCount',
  'convertedCount',
  'lostCount',
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

/**
 * Each metric is an existing report's own predicate, so an owner's "Converted Leads" is
 * exactly what the Converted Leads report would list for them, and so on.
 */
const METRIC_WHERE: Record<MetricKey, Prisma.LeadWhereInput> = {
  newCount: { status: NEW_STATUS },
  contactedCount: answeredCallWhere(),
  noActivityCount: noEngagementWhere(),
  convertedCount: { status: CONVERTED_STATUS },
  lostCount: { status: LOST_STATUS },
};

function toOwnerRow(
  base: Pick<OwnerCountRow, 'ownerId' | 'ownerName' | 'count'>,
  metrics: Record<MetricKey, number>,
  value: Prisma.Decimal,
): OwnerCountRow {
  return {
    ...base,
    ...metrics,
    conversionRatio:
      base.count > 0 ? (metrics.convertedCount / base.count) * 100 : 0,
    // No qualification stage/flag and no sales-target model exist in Emarath.
    qualifiedRatio: null,
    targetAchievement: null,
    leadValue: value.toString(),
  };
}

/**
 * The Leads By Ownership report (RPT-02.5).
 *
 * Every read composes `buildLeadsByOwnershipWhere` — role scope + soft-delete + creation window
 * + team (reused from the leads module and RPT-02.3's `teamWhere`) — so the list, the summary
 * and the export all return exactly the same scoped set. The summary counts leads per assignee
 * with one `leadAssignment.groupBy` (server-side, no per-row query); a co-assigned lead counts
 * under each of its owners (there is no primary-owner field), matching how the Leads list and
 * role scope already treat assignment. Leads with no assignment form the "Unassigned" bucket.
 */
@Injectable()
export class LeadsByOwnershipReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of leads with their owner(s) (AC1). */
  async listDetailed(
    query: LeadsByOwnershipQueryDto,
  ): Promise<LeadsByOwnershipListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsByOwnershipWhere(user, query);

    // The Leads list projection, so the detailed view renders the list's own columns; page +
    // count in one transaction so `total` never describes a different snapshot than `rows`.
    const [[leads, total], colorByStatus] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          select: LEAD_LIST_SELECT,
          orderBy: ORDER_BY,
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.lead.count({ where }),
      ]),
      this.stageColorByName(),
    ]);

    return {
      rows: leads.map((lead) => ({
        ...toLeadListItem(lead),
        statusColor: colorByStatus.get(lead.status) ?? null,
      })),
      total,
    };
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

  /**
   * The summary view: lead counts per owner (AC1/AC2). A sales agent only ever sees themselves
   * — the same rule the leads `filterOptions` applies — so a shared lead's co-owner is never
   * named in an agent's report; managers and admins see the per-owner breakdown their scope
   * permits, plus the "Unassigned" bucket. `total` is the distinct lead count; the per-owner
   * counts can sum to more than that when leads are co-assigned.
   */
  async summary(
    query: LeadsByOwnershipQueryDto,
  ): Promise<LeadsByOwnershipSummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsByOwnershipWhere(user, query);
    const and = (extra: Prisma.LeadWhereInput): Prisma.LeadWhereInput => ({
      AND: [where, extra],
    });

    // A sales agent only ever sees themselves — a co-assigned lead's other owner is never
    // named in an agent's report — so their row is the scoped set as a whole.
    if (user.role === UserRole.SALES_AGENT) {
      const [count, self, metrics, value] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true },
        }),
        this.metricsFor(where),
        this.prisma.lead.aggregate({ where, _sum: { actualAmount: true } }),
      ]);
      const rows: OwnerCountRow[] =
        count > 0 && self
          ? [
              toOwnerRow(
                { ownerId: self.id, ownerName: self.name, count },
                metrics,
                value._sum.actualAmount ?? ZERO,
              ),
            ]
          : [];
      return { rows, total: count };
    }

    const unassignedWhere = and({ assignments: { none: {} } });
    const [
      grouped,
      total,
      unassigned,
      byUser,
      unassignedMetrics,
      valueRows,
      unassignedValue,
    ] = await Promise.all([
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: { lead: where },
        _count: { _all: true },
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: unassignedWhere }),
      this.metricsByUser(and),
      this.metricsFor(unassignedWhere),
      // ponytail: Σ actualAmount per owner summed in-app (Prisma can't sum a Lead field
      // across the assignment join) over a two-field projection — the same trade the
      // Converted report makes; a scoped raw query if the assignment table ever gets huge.
      this.prisma.leadAssignment.findMany({
        where: { lead: where },
        select: { userId: true, lead: { select: { actualAmount: true } } },
      }),
      this.prisma.lead.aggregate({
        where: unassignedWhere,
        _sum: { actualAmount: true },
      }),
    ]);
    const names = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((group) => group.userId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((named) => [named.id, named.name]));
    const valueByUser = new Map<string, Prisma.Decimal>();
    for (const row of valueRows) {
      valueByUser.set(
        row.userId,
        (valueByUser.get(row.userId) ?? ZERO).add(
          row.lead.actualAmount ?? ZERO,
        ),
      );
    }
    const rows: OwnerCountRow[] = grouped
      .map((group) =>
        toOwnerRow(
          {
            ownerId: group.userId,
            ownerName: nameById.get(group.userId) ?? 'Unknown',
            count: group._count._all,
          },
          Object.fromEntries(
            METRIC_KEYS.map((key) => [key, byUser[key].get(group.userId) ?? 0]),
          ) as Record<MetricKey, number>,
          valueByUser.get(group.userId) ?? ZERO,
        ),
      )
      .sort(
        (a, b) => b.count - a.count || a.ownerName.localeCompare(b.ownerName),
      );
    if (unassigned > 0) {
      rows.push(
        toOwnerRow(
          { ownerId: null, ownerName: UNASSIGNED_LABEL, count: unassigned },
          unassignedMetrics,
          unassignedValue._sum.actualAmount ?? ZERO,
        ),
      );
    }
    return { rows, total };
  }

  /** Each metric's per-owner counts — one `leadAssignment.groupBy` per metric, never per row. */
  private async metricsByUser(
    and: (extra: Prisma.LeadWhereInput) => Prisma.LeadWhereInput,
  ): Promise<Record<MetricKey, Map<string, number>>> {
    const groups = await Promise.all(
      METRIC_KEYS.map((key) =>
        this.prisma.leadAssignment.groupBy({
          by: ['userId'],
          where: { lead: and(METRIC_WHERE[key]) },
          _count: { _all: true },
        }),
      ),
    );
    return Object.fromEntries(
      METRIC_KEYS.map((key, index) => [
        key,
        new Map(
          groups[index].map((group) => [group.userId, group._count._all]),
        ),
      ]),
    ) as Record<MetricKey, Map<string, number>>;
  }

  /** Each metric's count over one lead set (the Unassigned bucket, or an agent's own leads). */
  private async metricsFor(
    where: Prisma.LeadWhereInput,
  ): Promise<Record<MetricKey, number>> {
    const counts = await Promise.all(
      METRIC_KEYS.map((key) =>
        this.prisma.lead.count({ where: { AND: [where, METRIC_WHERE[key]] } }),
      ),
    );
    return Object.fromEntries(
      METRIC_KEYS.map((key, index) => [key, counts[index]]),
    ) as Record<MetricKey, number>;
  }

  /**
   * Streams the scoped leads to a CSV download (AC5). The `where` is the same scoped query as
   * the visible report, so the file can never expose a lead the caller cannot see and always
   * reflects the active period/team filters. Rows are pulled in batches and written straight to
   * the response, so memory stays flat regardless of match count.
   */
  async exportCsv(
    query: LeadsByOwnershipQueryDto,
    res: Response,
  ): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsByOwnershipWhere(user, query);

    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${exportFilename()}"`,
      );

    // A BOM so Excel opens the UTF-8 content (Arabic names) without mojibake.
    res.write('﻿');
    res.write(
      EXPORT_HEADERS.map((header) => csvCell(header)).join(',') + '\r\n',
    );

    let skip = 0;
    while (skip < MAX_EXPORT_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: LEADS_BY_OWNERSHIP_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: EXPORT_BATCH_SIZE,
      });
      if (leads.length === 0) break;

      let chunk = '';
      for (const lead of leads) {
        chunk +=
          [
            csvCell(lead.name),
            csvCell(lead.firstName ?? ''),
            csvCell(lead.primaryPhone),
            csvCell(lead.source ?? ''),
            csvCell(
              lead.assignments.map((a) => a.user.name).join('; ') ||
                UNASSIGNED_LABEL,
            ),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (leads.length < EXPORT_BATCH_SIZE) break;
      skip += EXPORT_BATCH_SIZE;
    }

    res.end();
  }

  /** The team values the filter offers (AC3): the distinct non-empty `User.team` labels. */
  async filterOptions(): Promise<LeadsByOwnershipFilterOptions> {
    const rows = await this.prisma.user.findMany({
      where: { team: { not: null }, deletedAt: null },
      select: { team: true },
      distinct: ['team'],
      orderBy: { team: 'asc' },
    });
    return {
      teams: rows
        .map((row) => row.team)
        .filter((team): team is string => team !== null),
    };
  }
}

/** A timestamped, download-safe name: `leads-by-ownership-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `leads-by-ownership-${stamp}.csv`;
}
