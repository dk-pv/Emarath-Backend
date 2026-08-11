import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildNoActivityWhere } from './no-activity-where';
import { NoActivityQueryDto } from './dto/no-activity-query.dto';
import {
  NO_ACTIVITY_SELECT,
  NoActivityListResponse,
  NoActivitySummaryResponse,
  NoActivitySummaryRow,
  toNoActivityRow,
} from './dto/no-activity-response.dto';

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
  'Last Activity',
] as const;

/**
 * The No Activity Leads report (RPT-02.1).
 *
 * Every read composes `buildNoActivityWhere` — role scope + soft-delete + source + agent
 * (reused from the leads module) ANDed with the "no recent activity" predicate — so the
 * list, the summary and the export all return exactly the same scoped set. The affected
 * leads are read in pages (never the whole table), and each lead's last-activity instant
 * is computed for the page in one `groupBy`, so there is no per-row query.
 */
@Injectable()
export class NoActivityReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of affected leads with their last activity (AC1/AC3). */
  async listDetailed(
    query: NoActivityQueryDto,
  ): Promise<NoActivityListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildNoActivityWhere(user, query);

    const [leads, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: NO_ACTIVITY_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.lead.count({ where }),
    ]);

    const lastById = await this.lastActivityByLead(
      leads.map((lead) => lead.id),
    );
    return {
      rows: leads.map((lead) =>
        toNoActivityRow(lead, lastById.get(lead.id) ?? null),
      ),
      total,
    };
  }

  /**
   * The summary view: affected-lead counts per assignee (Workpex "Assigned User | No. of
   * Leads"). A sales agent only ever sees themselves — the same rule `filterOptions` applies
   * — so a shared lead's co-assignee is never named in an agent's report; managers and admins
   * see the per-assignee breakdown their scope already permits.
   */
  async summary(query: NoActivityQueryDto): Promise<NoActivitySummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildNoActivityWhere(user, query);

    if (user.role === UserRole.SALES_AGENT) {
      const [count, self] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true },
        }),
      ]);
      const rows: NoActivitySummaryRow[] =
        count > 0 && self
          ? [{ agentId: self.id, agentName: self.name, count }]
          : [];
      return { rows, total: count };
    }

    const [grouped, unassigned, total] = await Promise.all([
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: { lead: where },
        _count: { _all: true },
      }),
      this.prisma.lead.count({
        where: { AND: [where, { assignments: { none: {} } }] },
      }),
      this.prisma.lead.count({ where }),
    ]);

    const names = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((group) => group.userId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((user) => [user.id, user.name]));

    const rows: NoActivitySummaryRow[] = grouped
      .map((group) => ({
        agentId: group.userId,
        agentName: nameById.get(group.userId) ?? 'Unknown',
        count: group._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    if (unassigned > 0) {
      rows.push({ agentId: null, agentName: 'Unassigned', count: unassigned });
    }

    return { rows, total };
  }

  /**
   * Streams the affected leads to a CSV download (AC5). The `where` is the same scoped query
   * as the visible report, so the file can never expose a lead the caller cannot see and
   * always reflects the active period/agent/source filters. Rows are pulled in batches and
   * written straight to the response, so memory stays flat regardless of match count.
   */
  async exportCsv(query: NoActivityQueryDto, res: Response): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildNoActivityWhere(user, query);

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
        select: NO_ACTIVITY_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: EXPORT_BATCH_SIZE,
      });
      if (leads.length === 0) break;

      const lastById = await this.lastActivityByLead(
        leads.map((lead) => lead.id),
      );
      let chunk = '';
      for (const lead of leads) {
        const last = lastById.get(lead.id);
        chunk +=
          [
            csvCell(lead.name),
            csvCell(lead.firstName ?? ''),
            csvCell(lead.primaryPhone),
            csvCell(lead.source ?? ''),
            csvCell(lead.assignments.map((a) => a.user.name).join('; ')),
            csvCell(last ? last.toISOString() : 'No activity'),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (leads.length < EXPORT_BATCH_SIZE) break;
      skip += EXPORT_BATCH_SIZE;
    }

    res.end();
  }

  /**
   * The most recent completed-activity instant per lead, for one page of ids, in a single
   * `groupBy` — so the "last activity" column costs one query, not one per row. Leads with
   * no completed activity are simply absent from the map (rendered as "No activity").
   */
  private async lastActivityByLead(ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.prisma.activity.groupBy({
      by: ['leadId'],
      where: {
        leadId: { in: ids },
        deletedAt: null,
        completedAt: { not: null },
      },
      _max: { completedAt: true },
    });
    return new Map(
      grouped
        .filter((group) => group._max.completedAt)
        .map((group) => [group.leadId, group._max.completedAt as Date]),
    );
  }
}

/** A timestamped, download-safe name: `no-activity-leads-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `no-activity-leads-${stamp}.csv`;
}
