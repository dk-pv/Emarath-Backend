import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildLeadsByOwnershipWhere } from './leads-by-ownership-where';
import { LeadsByOwnershipQueryDto } from './dto/leads-by-ownership-query.dto';
import {
  LEADS_BY_OWNERSHIP_SELECT,
  LeadsByOwnershipFilterOptions,
  LeadsByOwnershipListResponse,
  LeadsByOwnershipSummaryResponse,
  OwnerCountRow,
  UNASSIGNED_LABEL,
  toLeadsByOwnershipRow,
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

    const [leads, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: LEADS_BY_OWNERSHIP_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { rows: leads.map(toLeadsByOwnershipRow), total };
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

    if (user.role === UserRole.SALES_AGENT) {
      const [count, self] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true },
        }),
      ]);
      const rows: OwnerCountRow[] =
        count > 0 && self
          ? [{ ownerId: self.id, ownerName: self.name, count }]
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
    const nameById = new Map(names.map((named) => [named.id, named.name]));

    const rows: OwnerCountRow[] = grouped
      .map((group) => ({
        ownerId: group.userId,
        ownerName: nameById.get(group.userId) ?? 'Unknown',
        count: group._count._all,
      }))
      .sort(
        (a, b) => b.count - a.count || a.ownerName.localeCompare(b.ownerName),
      );

    if (unassigned > 0) {
      rows.push({
        ownerId: null,
        ownerName: UNASSIGNED_LABEL,
        count: unassigned,
      });
    }

    return { rows, total };
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
