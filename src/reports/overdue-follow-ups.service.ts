import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ActivityType, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildOverdueFollowUpsWhere } from './overdue-follow-ups-where';
import { OverdueFollowUpsQueryDto } from './dto/overdue-follow-ups-query.dto';
import {
  OVERDUE_FOLLOW_UPS_SELECT,
  OverdueFollowUpsFilterOptions,
  OverdueFollowUpsListResponse,
  OverdueFollowUpsSummaryResponse,
  OverdueFollowUpsSummaryRow,
  toOverdueFollowUpRow,
} from './dto/overdue-follow-ups-response.dto';

/** Rows are read in pages so a large export never loads the whole set at once. */
const EXPORT_BATCH_SIZE = 1000;
/** A hard ceiling so a runaway filter cannot stream unbounded rows. */
const MAX_EXPORT_ROWS = 100_000;

/** Oldest overdue first; id breaks ties so a row never repeats or vanishes across pages/batches. */
const ORDER_BY: Prisma.ActivityOrderByWithRelationInput[] = [
  { dueAt: 'asc' },
  { id: 'asc' },
];

/** The Workpex "Follow Up Type" labels — same casing the Activities title uses. */
const TYPE_LABEL: Record<ActivityType, string> = {
  CALL: 'Call',
  MEETING: 'Meeting',
  TASK: 'Task',
};

const EXPORT_HEADERS = [
  'Customer Name',
  'Follow Up Type',
  'Due Date',
  'Primary Phone',
  'Assigned',
] as const;

/**
 * The Overdue Follow Ups report (RPT-03.2).
 *
 * "Overdue" reuses the Activities module's own definition — `completedAt IS NULL AND dueAt <
 * todayStart` via `activityBucketWhere('overdue', …)` — never a second copy, so the report's
 * figures reconcile with the Activities worklist's Overdue tab (AC3). Every read composes the one
 * `buildOverdueFollowUpsWhere`, which folds in the caller's activity scope + the createdAt period +
 * the agent/team filters, so the list, the summary and the export return exactly the same scoped
 * set and never leak an activity outside the caller's scope (AC4). There is no status-history
 * field, so a true historical "trend" is not computable and Workpex shows only a snapshot; this is
 * that snapshot (see the RPT-03.2 discovery — trend AC deviation).
 */
@Injectable()
export class OverdueFollowUpsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The detailed view: a scoped page of overdue follow-ups (AC1). */
  async listDetailed(
    query: OverdueFollowUpsQueryDto,
  ): Promise<OverdueFollowUpsListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildOverdueFollowUpsWhere(user, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where,
        select: OVERDUE_FOLLOW_UPS_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.activity.count({ where }),
    ]);

    return { rows: rows.map(toOverdueFollowUpRow), total };
  }

  /**
   * The summary view: overdue-follow-up counts per assignee ("Assigned User | Overdue Count"),
   * sorted A→Z by name (Workpex parity), with a defensive "Unassigned" bucket and no Total row.
   * A sales agent only ever sees themselves — a co-assignee of a shared overdue follow-up is never
   * named in an agent's report; managers and admins see the per-assignee breakdown their scope
   * already permits. The groupBy is over assignees of activities matching the fully scoped `where`
   * only — never an unrestricted assignee scan.
   */
  async summary(
    query: OverdueFollowUpsQueryDto,
  ): Promise<OverdueFollowUpsSummaryResponse> {
    const user = await this.currentUser.resolve();
    const where = buildOverdueFollowUpsWhere(user, query);

    if (user.role === UserRole.SALES_AGENT) {
      const [count, self] = await Promise.all([
        this.prisma.activity.count({ where }),
        this.prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true },
        }),
      ]);
      if (count === 0 || !self) return { rows: [], total: 0 };
      return {
        rows: [{ agentId: self.id, agentName: self.name, count }],
        total: count,
      };
    }

    const [grouped, unassigned, total] = await Promise.all([
      this.prisma.activityAssignee.groupBy({
        by: ['userId'],
        where: { activity: where },
        _count: { _all: true },
      }),
      this.prisma.activity.count({
        where: { AND: [where, { assignees: { none: {} } }] },
      }),
      this.prisma.activity.count({ where }),
    ]);

    if (total === 0) return { rows: [], total: 0 };

    const names = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((group) => group.userId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((entry) => [entry.id, entry.name]));

    const rows: OverdueFollowUpsSummaryRow[] = grouped
      .map((group) => ({
        agentId: group.userId,
        agentName: nameById.get(group.userId) ?? 'Unknown',
        count: group._count._all,
      }))
      // Alphabetical by assignee, matching the Workpex reference (not by count).
      .sort((a, b) => a.agentName.localeCompare(b.agentName));

    if (unassigned > 0) {
      rows.push({ agentId: null, agentName: 'Unassigned', count: unassigned });
    }

    return { rows, total };
  }

  /**
   * Streams the overdue follow-ups to a CSV download. The `where` is the same scoped query as the
   * visible report, so the file can never expose an activity the caller cannot see and always
   * reflects the active period/agent/team filters. Rows are pulled in batches and written straight
   * to the response, so memory stays flat regardless of match count.
   */
  async exportCsv(
    query: OverdueFollowUpsQueryDto,
    res: Response,
  ): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildOverdueFollowUpsWhere(user, query);

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
      const rows = await this.prisma.activity.findMany({
        where,
        select: OVERDUE_FOLLOW_UPS_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: EXPORT_BATCH_SIZE,
      });
      if (rows.length === 0) break;

      let chunk = '';
      for (const activity of rows) {
        chunk +=
          [
            csvCell(activity.lead.name),
            csvCell(TYPE_LABEL[activity.type]),
            csvCell(activity.dueAt.toISOString()),
            csvCell(activity.lead.primaryPhone),
            csvCell(activity.assignees.map((a) => a.user.name).join('; ')),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (rows.length < EXPORT_BATCH_SIZE) break;
      skip += EXPORT_BATCH_SIZE;
    }

    res.end();
  }

  /** The team values the filter offers (AC2): the distinct non-empty `User.team` labels. */
  async filterOptions(): Promise<OverdueFollowUpsFilterOptions> {
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

/** A timestamped, download-safe name: `overdue-follow-ups-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `overdue-follow-ups-${stamp}.csv`;
}
