import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildLeadsByStatusWhere } from './leads-by-status-where';
import { LeadsByStatusQueryDto } from './dto/leads-by-status-query.dto';
import {
  LEADS_BY_STATUS_SELECT,
  LeadsByStatusFilterOptions,
  LeadsByStatusListResponse,
  LeadsByStatusSummaryResponse,
  StatusCountRow,
  toLeadsByStatusRow,
} from './dto/leads-by-status-response.dto';

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
  'Status',
  'Assigned',
] as const;

/**
 * The Leads By Status report (RPT-02.3).
 *
 * Every read composes `buildLeadsByStatusWhere` — role scope + soft-delete + creation
 * window + team (reused/derived from the leads module) — so the list, the summary and the
 * export all return exactly the same scoped set. The summary groups by `status` in the
 * database (one `groupBy`, not per-row) for the counts and the breakdown chart; each status
 * carries its Stage colour key so the chart uses the product's real palette, never an
 * invented colour.
 */
@Injectable()
export class LeadsByStatusReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of leads with their status (AC1/AC3). */
  async listDetailed(
    query: LeadsByStatusQueryDto,
  ): Promise<LeadsByStatusListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsByStatusWhere(user, query);

    // Page + count in one transaction so `total` can never describe a different
    // snapshot than `rows` — the same guarantee every sibling report gives.
    const [[leads, total], colorByStatus] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          select: LEADS_BY_STATUS_SELECT,
          orderBy: ORDER_BY,
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.lead.count({ where }),
      ]),
      this.stageColorByName(),
    ]);

    return {
      rows: leads.map((lead) =>
        toLeadsByStatusRow(lead, colorByStatus.get(lead.status) ?? null),
      ),
      total,
    };
  }

  /**
   * The summary view: lead counts per status (AC1/AC2), most-populous first. Groups by
   * `status` over the scoped set, so a sales agent's chart reflects only their own leads.
   * Each row carries its Stage colour key for the breakdown chart.
   */
  async summary(
    query: LeadsByStatusQueryDto,
  ): Promise<LeadsByStatusSummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsByStatusWhere(user, query);

    const [grouped, colorByStatus] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.stageColorByName(),
    ]);

    const rows: StatusCountRow[] = grouped
      .map((group) => ({
        status: group.status,
        count: group._count._all,
        color: colorByStatus.get(group.status) ?? null,
      }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return { rows, total };
  }

  /**
   * Streams the scoped leads to a CSV download (AC5). The `where` is the same scoped query
   * as the visible report, so the file can never expose a lead the caller cannot see and
   * always reflects the active period/team filters. Rows are pulled in batches and written
   * straight to the response, so memory stays flat regardless of match count.
   */
  async exportCsv(query: LeadsByStatusQueryDto, res: Response): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsByStatusWhere(user, query);

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
        select: LEADS_BY_STATUS_SELECT,
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
            csvCell(lead.status),
            csvCell(lead.assignments.map((a) => a.user.name).join('; ')),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (leads.length < EXPORT_BATCH_SIZE) break;
      skip += EXPORT_BATCH_SIZE;
    }

    res.end();
  }

  /** The team values the filter offers (AC3): the distinct non-empty `User.team` labels. */
  async filterOptions(): Promise<LeadsByStatusFilterOptions> {
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

  /**
   * status name → Stage colour key, from the catalogue (KAN-05.1). Statuses with no stage
   * entry are simply absent (rendered neutral). If a name existed in two pipelines with
   * different colours the first (by pipeline, then position) wins; the seed has no such
   * collision.
   */
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

/** A timestamped, download-safe name: `leads-by-status-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `leads-by-status-${stamp}.csv`;
}
