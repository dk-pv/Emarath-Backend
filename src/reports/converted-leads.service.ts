import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildConvertedLeadsWhere } from './converted-leads-where';
import { ConvertedLeadsQueryDto } from './dto/converted-leads-query.dto';
import {
  CONVERTED_LEADS_SELECT,
  CONVERTED_SUMMARY_SELECT,
  ConvertedLeadsListResponse,
  ConvertedLeadsSummaryResponse,
  ConvertedLeadsSummaryRow,
  toConvertedLeadRow,
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

/** The synthetic "Total" summary row — distinct converted leads + grand total amount (AED). */
function totalRow(
  count: number,
  amount: Prisma.Decimal,
): ConvertedLeadsSummaryRow {
  return {
    agentId: null,
    agentName: 'Total',
    count,
    amount: amount.toString(),
    isTotal: true,
  };
}

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

    const [leads, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: CONVERTED_LEADS_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { rows: leads.map(toConvertedLeadRow), total };
  }

  /**
   * The summary view: converted-lead count + total converted amount per assignee ("Assigned User
   * | No. of Leads | Converted Amount"), plus an "Unassigned" bucket and a "Total" row. A sales
   * agent only ever sees themselves — a shared lead's co-assignee is never named in an agent's
   * report; managers and admins see the per-assignee breakdown their scope already permits.
   */
  async summary(
    query: ConvertedLeadsQueryDto,
  ): Promise<ConvertedLeadsSummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildConvertedLeadsWhere(user, query);

    if (user.role === UserRole.SALES_AGENT) {
      const [agg, self] = await Promise.all([
        this.prisma.lead.aggregate({
          where,
          _count: { _all: true },
          _sum: { actualAmount: true },
        }),
        this.prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true },
        }),
      ]);
      const count = agg._count._all;
      const amount = agg._sum.actualAmount ?? ZERO;
      if (count === 0 || !self) return { rows: [], total: 0 };
      return {
        rows: [
          {
            agentId: self.id,
            agentName: self.name,
            count,
            amount: amount.toString(),
          },
          totalRow(count, amount),
        ],
        total: count,
      };
    }

    const agg = await this.aggregateByAssignee(where);
    if (agg.total === 0) return { rows: [], total: 0 };

    const names = await this.prisma.user.findMany({
      where: { id: { in: [...agg.perUser.keys()] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((entry) => [entry.id, entry.name]));

    const rows: ConvertedLeadsSummaryRow[] = [...agg.perUser.entries()]
      .map(([userId, group]) => ({
        agentId: userId,
        agentName: nameById.get(userId) ?? 'Unknown',
        count: group.count,
        amount: group.amount.toString(),
      }))
      .sort(
        (a, b) => b.count - a.count || a.agentName.localeCompare(b.agentName),
      );

    if (agg.unassignedCount > 0) {
      rows.push({
        agentId: null,
        agentName: 'Unassigned',
        count: agg.unassignedCount,
        amount: agg.unassignedAmount.toString(),
      });
    }
    rows.push(totalRow(agg.total, agg.totalAmount));

    return { rows, total: agg.total };
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
        select: CONVERTED_LEADS_SELECT,
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

  /**
   * Per-assignee count + Σ actualAmount over the scoped converted set, plus the Unassigned bucket
   * and grand totals — computed in one batched pass over a minimal projection.
   *
   * ponytail: aggregated in-app because Prisma `groupBy` can't sum a Lead field (`actualAmount`)
   * across the assignment join, and a raw grouped SQL query would have to re-derive the role
   * scope `leadScopeWhere` owns. The projection is tiny (amount + assignee ids) and the converted
   * subset is a small fraction of all leads; upgrade to a scoped raw query only if that subset
   * ever gets huge. A co-assigned lead adds to each assignee (like the count), so per-assignee
   * amounts can exceed the distinct grand total — the same convention as the per-agent counts.
   */
  private async aggregateByAssignee(where: Prisma.LeadWhereInput): Promise<{
    perUser: Map<string, { count: number; amount: Prisma.Decimal }>;
    unassignedCount: number;
    unassignedAmount: Prisma.Decimal;
    total: number;
    totalAmount: Prisma.Decimal;
  }> {
    const perUser = new Map<
      string,
      { count: number; amount: Prisma.Decimal }
    >();
    let unassignedCount = 0;
    let unassignedAmount = ZERO;
    let total = 0;
    let totalAmount = ZERO;

    let skip = 0;
    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: CONVERTED_SUMMARY_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: BATCH_SIZE,
      });
      if (leads.length === 0) break;

      for (const lead of leads) {
        const amount = lead.actualAmount ?? ZERO;
        total += 1;
        totalAmount = totalAmount.add(amount);
        if (lead.assignments.length === 0) {
          unassignedCount += 1;
          unassignedAmount = unassignedAmount.add(amount);
        } else {
          for (const assignment of lead.assignments) {
            const group = perUser.get(assignment.userId) ?? {
              count: 0,
              amount: ZERO,
            };
            group.count += 1;
            group.amount = group.amount.add(amount);
            perUser.set(assignment.userId, group);
          }
        }
      }

      if (leads.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }

    return { perUser, unassignedCount, unassignedAmount, total, totalAmount };
  }
}

/** A timestamped, download-safe name: `converted-leads-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `converted-leads-${stamp}.csv`;
}
