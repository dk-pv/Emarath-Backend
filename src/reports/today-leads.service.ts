import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildTodayLeadsWhere } from './today-leads-where';
import { TodayLeadsQueryDto } from './dto/today-leads-query.dto';
import {
  TODAY_LEADS_SELECT,
  TodayLeadsListResponse,
  TodayLeadsSummaryResponse,
  TodayLeadsSummaryRow,
  toTodayLeadRow,
} from './dto/today-leads-response.dto';

/** Rows are read in pages so a large export never loads the whole set at once. */
const EXPORT_BATCH_SIZE = 1000;
/** A hard ceiling so a runaway filter cannot stream unbounded rows. */
const MAX_EXPORT_ROWS = 100_000;

/**
 * Most-engaged first (RPT-02.2 "high engagement"): there is no engagement score in the
 * schema, so the existing outreach counters order the list — call attempts, then WhatsApp
 * attempts, descending. `createdAt`/`id` break ties so a row never repeats or vanishes
 * across pages/batches. No invented composite metric.
 */
const ORDER_BY: Prisma.LeadOrderByWithRelationInput[] = [
  { callAttempts: 'desc' },
  { whatsappAttempts: 'desc' },
  { createdAt: 'desc' },
  { id: 'asc' },
];

const EXPORT_HEADERS = [
  'Customer Name',
  'First Name',
  'Primary Phone',
  'Source',
  'Assigned',
  'Call Attempts',
  'WhatsApp Attempts',
  'Last Contacted',
] as const;

/**
 * The Today Leads report (RPT-02.2).
 *
 * Every read composes `buildTodayLeadsWhere` — role scope + soft-delete + source + agent
 * (reused from the leads module) ANDed with the "recently contacted" predicate (a Call in
 * the window) — so the list, the summary and the export all return exactly the same scoped
 * set. Leads are read in pages (never the whole table), and each lead's last-contacted
 * instant is computed for the page in one `groupBy`, so there is no per-row query.
 */
@Injectable()
export class TodayLeadsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of recently-contacted leads with their last contact (AC1/AC3). */
  async listDetailed(
    query: TodayLeadsQueryDto,
  ): Promise<TodayLeadsListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildTodayLeadsWhere(user, query);

    const [leads, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: TODAY_LEADS_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.lead.count({ where }),
    ]);

    const lastById = await this.lastContactedByLead(
      leads.map((lead) => lead.id),
    );
    return {
      rows: leads.map((lead) =>
        toTodayLeadRow(lead, lastById.get(lead.id) ?? null),
      ),
      total,
    };
  }

  /**
   * The summary view: recently-contacted-lead counts per assignee (Workpex "Assigned User |
   * No. of Leads"). A sales agent only ever sees themselves — the same rule `filterOptions`
   * applies — so a shared lead's co-assignee is never named in an agent's report; managers
   * and admins see the per-assignee breakdown their scope already permits.
   */
  async summary(query: TodayLeadsQueryDto): Promise<TodayLeadsSummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildTodayLeadsWhere(user, query);

    if (user.role === UserRole.SALES_AGENT) {
      const [count, self] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true },
        }),
      ]);
      const rows: TodayLeadsSummaryRow[] =
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

    const rows: TodayLeadsSummaryRow[] = grouped
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
   * Streams the recently-contacted leads to a CSV download (AC5). The `where` is the same
   * scoped query as the visible report, so the file can never expose a lead the caller
   * cannot see and always reflects the active period/agent/source filters. Rows are pulled
   * in batches and written straight to the response, so memory stays flat regardless of
   * match count.
   */
  async exportCsv(query: TodayLeadsQueryDto, res: Response): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildTodayLeadsWhere(user, query);

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
        select: TODAY_LEADS_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: EXPORT_BATCH_SIZE,
      });
      if (leads.length === 0) break;

      const lastById = await this.lastContactedByLead(
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
            csvCell(String(lead.callAttempts)),
            csvCell(String(lead.whatsappAttempts)),
            csvCell(last ? last.toISOString() : 'Not contacted'),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (leads.length < EXPORT_BATCH_SIZE) break;
      skip += EXPORT_BATCH_SIZE;
    }

    res.end();
  }

  /**
   * The most recent call instant per lead, for one page of ids, in a single `groupBy` — so
   * the "last contacted" column costs one query, not one per row. Leads with no call are
   * simply absent from the map (rendered as "Not contacted").
   */
  private async lastContactedByLead(ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.prisma.call.groupBy({
      by: ['leadId'],
      where: { leadId: { in: ids }, deletedAt: null },
      _max: { startedAt: true },
    });
    return new Map(
      grouped
        .filter((group) => group._max.startedAt)
        .map((group) => [group.leadId, group._max.startedAt as Date]),
    );
  }
}

/** A timestamped, download-safe name: `today-leads-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `today-leads-${stamp}.csv`;
}
