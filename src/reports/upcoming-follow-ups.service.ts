import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ActivityType, Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildUpcomingFollowUpsWhere } from './upcoming-follow-ups-where';
import { UpcomingFollowUpsQueryDto } from './dto/upcoming-follow-ups-query.dto';
import {
  UPCOMING_FOLLOW_UPS_SELECT,
  UpcomingFollowUpsListResponse,
  toUpcomingFollowUpRow,
} from './dto/upcoming-follow-ups-response.dto';

/** Rows are read in pages so a large export never loads the whole set at once. */
const EXPORT_BATCH_SIZE = 1000;
/** A hard ceiling so a runaway filter cannot stream unbounded rows. */
const MAX_EXPORT_ROWS = 100_000;

/** Earliest due first — the schedule read in the order it comes up (the reference's order). */
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
 * The Upcoming Follow Ups report (RPT-03.3).
 *
 * "Upcoming" is open work due from tomorrow onward. The Activities worklist has no such tab —
 * its `tomorrow` bucket is a single day — so unlike its two siblings this report defines its own
 * predicate, in `upcomingWhere`; everything else (role scope, the agent/pipeline/type filters)
 * is the Activities module's own. A single view (the reference shows no Summary/Detailed
 * toggle): one scoped, paginated table ordered by the date the work falls due. The list and the
 * export compose the same `buildUpcomingFollowUpsWhere`, so the file can never contain a row the
 * screen would not show, nor one outside the caller's scope.
 */
@Injectable()
export class UpcomingFollowUpsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** One scoped page of the follow-ups due from tomorrow onward. */
  async list(
    query: UpcomingFollowUpsQueryDto,
  ): Promise<UpcomingFollowUpsListResponse> {
    const user = await this.currentUser.resolve();
    const where = buildUpcomingFollowUpsWhere(user, query);

    const [[rows, total], colorByStatus] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.activity.findMany({
          where,
          select: UPCOMING_FOLLOW_UPS_SELECT,
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
        toUpcomingFollowUpRow(
          activity,
          colorByStatus.get(activity.lead.status) ?? null,
        ),
      ),
      total,
    };
  }

  /**
   * Streams the upcoming follow-ups to a CSV download. The `where` is the same scoped query as the
   * visible report, so the file always reflects the active agent/pipeline/type filters and can
   * never expose an activity the caller cannot see. Rows are pulled in batches and written
   * straight to the response, so memory stays flat regardless of match count.
   */
  async exportCsv(
    query: UpcomingFollowUpsQueryDto,
    res: Response,
  ): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = buildUpcomingFollowUpsWhere(user, query);

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
        select: UPCOMING_FOLLOW_UPS_SELECT,
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

/** A timestamped, download-safe name: `upcoming-follow-ups-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `upcoming-follow-ups-${stamp}.csv`;
}
