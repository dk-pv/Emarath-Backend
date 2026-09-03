import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ActivityType, Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildTodaysFollowUpsWhere } from './todays-follow-ups-where';
import { TodaysFollowUpsQueryDto } from './dto/todays-follow-ups-query.dto';
import {
  TODAYS_FOLLOW_UPS_SELECT,
  TodaysFollowUpsListResponse,
  toTodaysFollowUpRow,
} from './dto/todays-follow-ups-response.dto';

/** Rows are read in pages so a large export never loads the whole set at once. */
const EXPORT_BATCH_SIZE = 1000;
/** A hard ceiling so a runaway filter cannot stream unbounded rows. */
const MAX_EXPORT_ROWS = 100_000;

/** Earliest due first — the day read in the order it has to be worked. */
const ORDER_BY: Prisma.ActivityOrderByWithRelationInput[] = [
  { dueAt: 'asc' },
  { id: 'asc' },
];

/** The "Follow up Type" labels — same casing the Activities title uses. */
const TYPE_LABEL: Record<ActivityType, string> = {
  CALL: 'Call',
  MEETING: 'Meeting',
  TASK: 'Task',
};

/** The table's own columns, in its order — the file matches what the screen shows. */
const EXPORT_HEADERS = [
  'Lead Name',
  'Lead Status',
  'Assigned User',
  'Follow up Type',
  'Date & Time',
  'Notes',
] as const;

/**
 * The Today's Follow Ups report (RPT-03.1).
 *
 * "Today" reuses the Activities module's own definition — `completedAt IS NULL AND dueAt >=
 * todayStart AND dueAt < todayEnd` via `activityBucketWhere('today', …)` — never a second copy,
 * so the report's figures reconcile with the Activities worklist's Today tab. A single view
 * (the reference shows no Summary/Detailed toggle): one scoped, paginated table. The list and
 * the export compose the same `buildTodaysFollowUpsWhere`, so the file can never contain a row
 * the screen would not show, nor one outside the caller's scope.
 */
@Injectable()
export class TodaysFollowUpsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** One scoped page of the follow-ups due today. */
  async list(
    query: TodaysFollowUpsQueryDto,
  ): Promise<TodaysFollowUpsListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildTodaysFollowUpsWhere(user, query);

    const [[rows, total], colorByStatus] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.activity.findMany({
          where,
          select: TODAYS_FOLLOW_UPS_SELECT,
          orderBy: ORDER_BY,
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.activity.count({ where }),
      ]),
      this.stageColorByName(),
    ]);

    return {
      rows: rows.map((activity) =>
        toTodaysFollowUpRow(
          activity,
          colorByStatus.get(activity.lead.status) ?? null,
        ),
      ),
      total,
    };
  }

  /**
   * Streams the day's follow-ups to a CSV download. The `where` is the same scoped query as the
   * visible report, so the file always reflects the active agent/pipeline/type filters and can
   * never expose an activity the caller cannot see. Rows are pulled in batches and written
   * straight to the response, so memory stays flat regardless of match count.
   */
  async exportCsv(
    query: TodaysFollowUpsQueryDto,
    res: Response,
  ): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildTodaysFollowUpsWhere(user, query);

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
        select: TODAYS_FOLLOW_UPS_SELECT,
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
            csvCell(activity.lead.status),
            csvCell(activity.assignees.map((a) => a.user.name).join('; ')),
            csvCell(TYPE_LABEL[activity.type]),
            csvCell(activity.dueAt.toISOString()),
            csvCell(activity.description ?? ''),
          ].join(',') + '\r\n';
      }
      res.write(chunk);

      if (rows.length < EXPORT_BATCH_SIZE) break;
      skip += EXPORT_BATCH_SIZE;
    }

    res.end();
  }

  /**
   * Stage colour by status name — the first stage carrying a name wins across pipelines, the
   * same resolution every other report uses, so a status pill reads identically everywhere.
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

/** A timestamped, download-safe name: `todays-follow-ups-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `todays-follow-ups-${stamp}.csv`;
}
