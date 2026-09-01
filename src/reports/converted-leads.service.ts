import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { toLeadListItem } from '../leads/dto/lead-response.dto';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildConvertedLeadsWhere } from './converted-leads-where';
import { ConvertedLeadsQueryDto } from './dto/converted-leads-query.dto';
import {
  CONVERTED_EXPORT_SELECT,
  CONVERTED_LIST_SELECT,
  ConvertedLeadsListResponse,
} from './dto/converted-leads-response.dto';

/** Rows are read in pages so a large export/summary never loads the whole set at once. */
const BATCH_SIZE = 1000;
/** A hard ceiling so a runaway filter cannot stream unbounded rows. */
const MAX_ROWS = 100_000;

const ZERO = new Prisma.Decimal(0);

/**
 * Newest first, stable across pages/batches (`id` breaks ties so a row never repeats or
 * vanishes) — the same neutral ordering the other RPT-02.x reports use. No amount-based sort is
 * required by the ACs.
 */
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
  'Actual Amount',
] as const;

/**
 * The Converted Leads report (RPT-02.6).
 *
 * "Converted" is `status = WON` (approved definition, reused from the Leads quick filter). Every
 * read composes `buildConvertedLeadsWhere` — role scope + soft-delete + source + agent + the
 * createdAt period, all from the leads module's `buildLeadWhere` — so the list, the summary and
 * the export return exactly the same scoped set and never leak a lead outside the caller's scope
 * (AC4). The converted amount is the lead's `actualAmount`, in AED. There is no conversion
 * timestamp in the model, so the period filters `createdAt` ("created in the period, currently
 * WON"), matching every other RPT-02.x report.
 */
@Injectable()
export class ConvertedLeadsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of converted leads with their amount (AC1/AC2). */
  async listDetailed(
    query: ConvertedLeadsQueryDto,
  ): Promise<ConvertedLeadsListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildConvertedLeadsWhere(user, query);

    // The Leads list projection, so the view renders the list's own columns; page + count
    // in one transaction so `total` never describes a different snapshot than `rows`.
    const [[leads, total], colorByStatus] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          select: CONVERTED_LIST_SELECT,
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
        convertedAt: lead.statusChangedAt.toISOString(),
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
   * Streams the converted leads to a CSV download (AC5). The `where` is the same scoped query as
   * the visible report, so the file can never expose a lead the caller cannot see and always
   * reflects the active period/agent/source filters. Rows are pulled in batches and written
   * straight to the response, so memory stays flat regardless of match count. The amount is the
   * raw number (no currency glyph), so a spreadsheet reads it as a value — matching the Leads
   * export.
   */
  async exportCsv(query: ConvertedLeadsQueryDto, res: Response): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildConvertedLeadsWhere(user, query);

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
    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: CONVERTED_EXPORT_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: BATCH_SIZE,
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
            csvCell(lead.actualAmount?.toString() ?? ''),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (leads.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }

    res.end();
  }
}

/** A timestamped, download-safe name: `converted-leads-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `converted-leads-${stamp}.csv`;
}
