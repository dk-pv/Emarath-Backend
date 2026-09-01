import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  LEAD_LIST_SELECT,
  toLeadListItem,
} from '../leads/dto/lead-response.dto';
import { csvCell } from '../leads/export/leads-export.columns';
import { CONVERTED_STATUS } from './converted-leads-where';
import { buildLeadsBySourceWhere } from './leads-by-source-where';
import { LeadsBySourceQueryDto } from './dto/leads-by-source-query.dto';
import {
  LEADS_BY_SOURCE_SELECT,
  LeadsBySourceFilterOptions,
  LeadsBySourceListResponse,
  LeadsBySourceSummaryResponse,
  NO_SOURCE_LABEL,
  SourceCountRow,
} from './dto/leads-by-source-response.dto';

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

/**
 * The Leads By Source report (RPT-02.4).
 *
 * Every read composes `buildLeadsBySourceWhere` — role scope + soft-delete + creation window +
 * team (reused from the leads module and RPT-02.3's `teamWhere`) — so the list, the summary and
 * the export all return exactly the same scoped set. The summary groups by `source` in the
 * database (one `groupBy`, not per-row); leads whose source is null or blank fold into one
 * "No Source" bucket so every lead is counted and "share" is a true fraction of the whole.
 */
@Injectable()
export class LeadsBySourceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of leads with their source (AC1). */
  async listDetailed(
    query: LeadsBySourceQueryDto,
  ): Promise<LeadsBySourceListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsBySourceWhere(user, query);

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

  /**
   * The summary view: lead counts per source (AC1/AC2), most-populous first. Groups by `source`
   * over the scoped set, so a sales agent's breakdown reflects only their own leads. Null/blank
   * sources fold into one "No Source" bucket; `total` is the denominator the client uses for the
   * "share" percentages.
   */
  async summary(
    query: LeadsBySourceQueryDto,
  ): Promise<LeadsBySourceSummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsBySourceWhere(user, query);

    // Bucket counts and the converted (WON) counts per bucket — two `groupBy`s, never a
    // query per source. (`groupBy` can't ride a `$transaction` array: its generics don't
    // infer there, so this pairs them with `Promise.all` like the sibling reports.)
    const [grouped, convertedGrouped] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['source'],
        where: { AND: [where, { status: CONVERTED_STATUS }] },
        _count: { _all: true },
      }),
    ]);
    // Fold null and blank sources into one "No Source" bucket (two DB groups can map to it).
    const fold = (
      groups: { source: string | null; _count: { _all: number } }[],
    ): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const group of groups) {
        const label =
          group.source && group.source.trim() !== ''
            ? group.source
            : NO_SOURCE_LABEL;
        counts.set(label, (counts.get(label) ?? 0) + group._count._all);
      }
      return counts;
    };
    const counts = fold(grouped);
    const converted = fold(convertedGrouped);
    // The reference lists sources alphabetically with "No Source" last.
    // Share is of the FILTERED total — every bucket the caller's filters left in — so the
    // percentages always sum to 100 for the set on screen.
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const rows: SourceCountRow[] = [...counts.entries()]
      .map(([source, count]) => ({
        source,
        count,
        share: total > 0 ? (count / total) * 100 : 0,
        conversionRate:
          count > 0 ? ((converted.get(source) ?? 0) / count) * 100 : 0,
      }))
      .sort(
        (a, b) =>
          Number(a.source === NO_SOURCE_LABEL) -
            Number(b.source === NO_SOURCE_LABEL) ||
          a.source.localeCompare(b.source, undefined, { sensitivity: 'base' }),
      );
    return { rows, total };
  }

  /**
   * Streams the scoped leads to a CSV download (AC5). The `where` is the same scoped query as
   * the visible report, so the file can never expose a lead the caller cannot see and always
   * reflects the active period/team filters. Rows are pulled in batches and written straight to
   * the response, so memory stays flat regardless of match count.
   */
  async exportCsv(query: LeadsBySourceQueryDto, res: Response): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildLeadsBySourceWhere(user, query);

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
        select: LEADS_BY_SOURCE_SELECT,
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

  async filterOptions(): Promise<LeadsBySourceFilterOptions> {
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

/** A timestamped, download-safe name: `leads-by-source-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `leads-by-source-${stamp}.csv`;
}
