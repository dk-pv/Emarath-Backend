import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { toLeadListItem } from '../leads/dto/lead-response.dto';
import { csvCell } from '../leads/export/leads-export.columns';
import {
  LOST_STATUS,
  NO_REASON_VALUE,
  buildLostLeadsWhere,
} from './lost-leads-where';
import { LostLeadsQueryDto } from './dto/lost-leads-query.dto';
import {
  LOST_EXPORT_SELECT,
  LOST_LIST_SELECT,
  LostLeadsFilterOptions,
  LostLeadsListResponse,
  LostLeadsSummaryResponse,
  LostReasonCountRow,
} from './dto/lost-leads-response.dto';

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
 * The Lost Leads report (RPT-02.7).
 *
 * "Lost" is `status = LOST` (approved definition B1, Workpex parity — the reference shows Lost
 * Leads as leads whose Lead Status is LOST, with no loss-reason field). Every read composes
 * `buildLostLeadsWhere` — role scope + soft-delete + the createdAt period + team, all from the
 * leads module's `buildLeadWhere`/`teamWhere` — so the list, the summary and the export return
 * exactly the same scoped set and never leak a lead outside the caller's scope (AC4). There is no
 * conversion/lost timestamp in the model, so the period filters `createdAt` ("created in the
 * period, currently LOST"), matching every other RPT-02.x report.
 */
@Injectable()
export class LostLeadsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of lost leads with their (LOST) status (AC1). */
  async listDetailed(query: LostLeadsQueryDto): Promise<LostLeadsListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLostLeadsWhere(user, query);

    // The Leads list projection, so the view renders the list's own columns; page + count
    // in one transaction so `total` never describes a different snapshot than `rows`.
    const [[leads, total], statusColor] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          select: LOST_LIST_SELECT,
          orderBy: ORDER_BY,
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.lead.count({ where }),
      ]),
      this.lostStatusColor(),
    ]);

    return {
      rows: leads.map((lead) => ({
        ...toLeadListItem(lead),
        statusColor,
        lostAt: lead.statusChangedAt.toISOString(),
        lostReason: lead.lostReason,
      })),
      total,
    };
  }

  /**
   * The reason breakdown (RPT-02.7 v2): lost-lead counts per `lostReason` over the same
   * scoped `where` the list and export compose — grouped in the database, most common
   * first, with leads lost before reasons existed folded into "No reason recorded".
   */
  async summary(query: LostLeadsQueryDto): Promise<LostLeadsSummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildLostLeadsWhere(user, query);

    const [grouped, total] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['lostReason'],
        where,
        _count: { _all: true },
      }),
      this.prisma.lead.count({ where }),
    ]);

    const rows: LostReasonCountRow[] = grouped
      .map((group) => ({
        reason: group.lostReason ?? 'No reason recorded',
        value: group.lostReason ?? NO_REASON_VALUE,
        count: group._count._all,
      }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
    return { rows, total };
  }

  /**
   * Streams the lost leads to a CSV download (AC5). The `where` is the same scoped query as the
   * visible report, so the file can never expose a lead the caller cannot see and always reflects
   * the active period/team filters. Rows are pulled in batches and written straight to the
   * response, so memory stays flat regardless of match count.
   */
  async exportCsv(query: LostLeadsQueryDto, res: Response): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildLostLeadsWhere(user, query);

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
        select: LOST_EXPORT_SELECT,
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
  async filterOptions(): Promise<LostLeadsFilterOptions> {
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

  /** The Stage colour key for the LOST status, so the detailed pill uses the product's palette. */
  private async lostStatusColor(): Promise<string | null> {
    const stage = await this.prisma.stage.findFirst({
      where: { name: LOST_STATUS },
      select: { color: true },
      orderBy: [{ pipeline: 'asc' }, { position: 'asc' }],
    });
    return stage?.color ?? null;
  }
}

/** A timestamped, download-safe name: `lost-leads-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `lost-leads-${stamp}.csv`;
}
