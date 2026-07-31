import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { activityScopeWhere } from '../../activities/activity-scope';
import { gpsAgentWhere } from '../gps-scope';
// Reuse the leads export's RFC-4180 CSV escaper rather than re-implement it — the
// one place CSV quoting lives, shared across every export.
import { csvCell } from '../../leads/export/leads-export.columns';
import { resolveGpsBounds } from '../gps-period';
import {
  ExportColumn,
  GPS_EXPORT_COLUMNS,
  GpsExportRow,
} from './gps-export.columns';
import { ExportGpsQueryDto } from './dto/export-gps-query.dto';

/**
 * A hard ceiling so a wide period cannot stream unbounded rows (AC5 safety),
 * mirroring the leads export cap. GPS rows are tiny, so the whole capped set is
 * built in memory and time-sorted before streaming.
 * ponytail: in-memory merge across the 3 sources; swap for a cursor-merge only if
 * field-activity volume ever rivals the leads scale.
 */
const MAX_EXPORT_ROWS = 100_000;

const LOWER_BOUND = new Date(0);
const UPPER_BOUND = new Date(8640000000000000);

/**
 * Streams the scoped, period-filtered GPS activity (check-in/out, automatic
 * tracking, follow-up completions) to a CSV or XLSX download (GPS-08.1).
 *
 * Scope and period come from the same seam the map/list use — role scoping plus
 * `resolveGpsBounds` — so the file matches the on-screen view and respects role
 * scoping (AC2/AC4). Unlike the map's `getLocations` (capped per source for render
 * performance), the export reads the full set up to `MAX_EXPORT_ROWS` (AC3/AC5).
 * CSV and Excel reuse the leads export's `csvCell` and ExcelJS — no new dependency,
 * no second export engine.
 */
@Injectable()
export class GpsExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async export(query: ExportGpsQueryDto, res: Response): Promise<void> {
    const rows = await this.collect(query);
    const filename = exportFilename(query.format);

    if (query.format === 'xlsx') {
      await this.streamXlsx(res, rows, GPS_EXPORT_COLUMNS, filename);
      return;
    }
    this.streamCsv(res, rows, GPS_EXPORT_COLUMNS, filename);
  }

  /** Reads the three sources under the caller's scope + period and unifies them. */
  private async collect(query: ExportGpsQueryDto): Promise<GpsExportRow[]> {
    const user = await this.currentUser.resolve();

    // Same scoping the summary/locations reads apply (AUTH-02.1, ADR-0030 §6): agent →
    // self, manager → team, admin/others → all; the userId filter is intersected with
    // scope, never allowed to widen it. `assigneeNarrow` applies that narrowing to the
    // activity read, AND-ed so it cannot override the team scope.
    const agentWhere = gpsAgentWhere(user, query.userId);
    const assigneeNarrow: Prisma.ActivityWhereInput =
      query.userId && user.role !== UserRole.SALES_AGENT
        ? { assignees: { some: { userId: query.userId } } }
        : {};

    const { from, to } = resolveGpsBounds(query);
    const hasWindow = Boolean(from || to);
    const timeFilter = hasWindow ? { gte: from, lte: to } : undefined;
    const lower = from ?? LOWER_BOUND;
    const upper = to ?? UPPER_BOUND;
    const inRange = (ts: Date): boolean =>
      !hasWindow || (ts >= lower && ts <= upper);

    const [checkIns, points, activities] = await Promise.all([
      this.prisma.checkIn.findMany({
        where: {
          agent: agentWhere,
          deletedAt: null,
          OR: [{ checkInAt: timeFilter }, { checkOutAt: timeFilter }],
        },
        select: {
          agentId: true,
          checkInAt: true,
          checkInLat: true,
          checkInLng: true,
          checkOutAt: true,
          checkOutLat: true,
          checkOutLng: true,
          activityId: true,
        },
        orderBy: { checkInAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      }),
      this.prisma.locationPoint.findMany({
        where: { agent: agentWhere, recordedAt: timeFilter },
        select: { agentId: true, recordedAt: true, lat: true, lng: true },
        orderBy: { recordedAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      }),
      this.prisma.activity.findMany({
        where: {
          AND: [
            activityScopeWhere(user),
            assigneeNarrow,
            { completedAt: timeFilter ?? { not: null } },
          ],
        },
        select: {
          completedAt: true,
          checkIns: {
            where: { deletedAt: null, agent: agentWhere },
            select: { checkInLat: true, checkInLng: true, agentId: true },
            take: 1,
          },
        },
        orderBy: { completedAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      }),
    ]);

    // Raw rows carry agentId; the display name is resolved in one pass below.
    type RawRow = { agentId: string } & Omit<GpsExportRow, 'agentName'>;
    const rows: RawRow[] = [];

    for (const c of checkIns) {
      if (inRange(c.checkInAt)) {
        rows.push({
          agentId: c.agentId,
          timestamp: c.checkInAt,
          type: c.activityId ? 'LOCATION_CHECK_IN' : 'CHECK_IN',
          lat: c.checkInLat.toNumber(),
          lng: c.checkInLng.toNumber(),
        });
      }
      if (
        c.checkOutAt &&
        c.checkOutLat &&
        c.checkOutLng &&
        inRange(c.checkOutAt)
      ) {
        rows.push({
          agentId: c.agentId,
          timestamp: c.checkOutAt,
          type: 'CHECK_OUT',
          lat: c.checkOutLat.toNumber(),
          lng: c.checkOutLng.toNumber(),
        });
      }
    }

    for (const p of points) {
      rows.push({
        agentId: p.agentId,
        timestamp: p.recordedAt,
        type: 'AUTOMATIC_TRACKING',
        lat: p.lat.toNumber(),
        lng: p.lng.toNumber(),
      });
    }

    for (const act of activities) {
      if (act.completedAt && act.checkIns.length > 0) {
        rows.push({
          agentId: act.checkIns[0].agentId,
          timestamp: act.completedAt,
          type: 'FOLLOW_UP_COMPLETION',
          lat: act.checkIns[0].checkInLat.toNumber(),
          lng: act.checkIns[0].checkInLng.toNumber(),
        });
      }
    }

    // Resolve agent display names in one query (same pattern as getLocations).
    const agentIds = [...new Set(rows.map((r) => r.agentId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    });
    const nameByAgent = new Map(users.map((u) => [u.id, u.name]));

    return rows
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, MAX_EXPORT_ROWS)
      .map((r) => ({
        agentName: nameByAgent.get(r.agentId) ?? 'Unknown',
        timestamp: r.timestamp,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
      }));
  }

  private streamCsv(
    res: Response,
    rows: GpsExportRow[],
    columns: ExportColumn[],
    filename: string,
  ): void {
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // A BOM so Excel opens the UTF-8 content (Arabic names) without mojibake.
    res.write('﻿');
    res.write(columns.map((c) => csvCell(c.header)).join(',') + '\r\n');
    for (const row of rows) {
      res.write(columns.map((c) => csvCell(c.value(row))).join(',') + '\r\n');
    }
    res.end();
  }

  private async streamXlsx(
    res: Response,
    rows: GpsExportRow[],
    columns: ExportColumn[],
    filename: string,
  ): Promise<void> {
    res
      .status(200)
      .setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet('GPS Activity');
    sheet.addRow(columns.map((c) => c.header)).commit();
    for (const row of rows) {
      sheet.addRow(columns.map((c) => c.value(row))).commit();
    }
    sheet.commit();
    await workbook.commit();
  }
}

/** A timestamped, download-safe name: `gps-activity-YYYYMMDD-HHmmss.<ext>`. */
function exportFilename(format: 'csv' | 'xlsx'): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `gps-activity-${stamp}.${format}`;
}
