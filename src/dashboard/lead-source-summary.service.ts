import { Injectable } from '@nestjs/common';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { leadScopeWhere } from '../leads/lead-scope';
import { NO_SOURCE_LABEL } from '../reports/dto/leads-by-source-response.dto';
import { periodFilter } from './dashboard-agents';
import { LeadSourceSummaryQueryDto } from './dto/lead-source-summary-query.dto';

/** Which date dimension the matrix is built on — the widget's Created/Assigned toggle. */
export const LEAD_SOURCE_DATE_MODES = ['created', 'assigned'] as const;
export type LeadSourceDateMode = (typeof LEAD_SOURCE_DATE_MODES)[number];

const DAY_MS = 86_400_000;

/**
 * A ceiling on the columns one response may carry, in the spirit of the report
 * module's `MAX_EXPORT_ROWS`. It only ever binds on the All preset — every other
 * Dashboard period is at most a month — and the most recent days are the ones kept,
 * because a heatmap of the current quarter is useful where one of the last six years
 * is not.
 */
export const MAX_DAY_COLUMNS = 92;

/**
 * A ceiling on the rows read to build one matrix. Reached only by an unbounded All
 * preset on a large database; the response then describes the days it could cover
 * rather than silently reporting short counts.
 */
const MAX_SCAN_ROWS = 50_000;

export interface LeadSourceRow {
  source: string;
  /** One count per entry in `dates`, same order and length. */
  values: number[];
  total: number;
}

export interface LeadSourceSummary {
  /**
   * One ISO instant per column — the caller's own local midnight for that day.
   *
   * Deliberately not a `YYYY-MM-DD` or a "Sep 01" caption: the server would have to
   * render those in *its* timezone, and the client's local midnight is an instant
   * that falls on the previous calendar day there. So this follows the same rule as
   * every other date the product puts on the wire — an ISO instant out, formatted in
   * the browser — and the column captions are the client's to draw.
   */
  dates: string[];
  sources: LeadSourceRow[];
  /** Column totals — the reference's pinned Total row. Same order as `dates`. */
  dailyTotals: number[];
  /** The donut's centre figure: every lead the matrix accounts for. */
  grandTotal: number;
  /** True when the scan ceiling clipped the window (All on a very large database). */
  truncated: boolean;
}

/** One record reduced to the only two things the matrix needs. */
interface Point {
  at: Date;
  source: string | null;
  /** Deduplication key — the lead, so co-assignment cannot count a lead twice. */
  leadId: string;
}

/**
 * The Dashboard's Lead Source Summary (DASH-10.1).
 *
 * Daily lead volume by acquisition source, on whichever date dimension the widget's
 * toggle selects:
 *
 *   • **Created** — `Lead.createdAt`, counted against the lead's own source.
 *   • **Assigned** — `LeadAssignment.createdAt`, which the schema documents as
 *     "Workpex's Assigned Date — the row is created when assigned". Counts are
 *     **distinct leads per day**, not assignment rows: a lead handed to three agents
 *     on one day is one lead assigned that day, and counting the join rows would
 *     inflate both the cell and the donut.
 *
 * Role scope is `leadScopeWhere` in both modes — directly in Created, and through
 * the `lead` relation in Assigned, the same composition `assignedInPeriodWhere`
 * already uses. Null and blank sources fold into the one "No Source" bucket the
 * Leads By Source report defines, so every lead is accounted for and the donut's
 * shares are true fractions.
 *
 * **Bucketing happens here, not in SQL.** Grouping by calendar day means grouping in
 * the *caller's* timezone, and the role scope is a Prisma `where` — expressing it in
 * raw SQL would be a second authorisation model, which is the one thing this must not
 * become. So the scoped rows are read two columns wide and folded in memory, bounded
 * by `MAX_SCAN_ROWS`.
 */
@Injectable()
export class LeadSourceSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getSummary(
    query: LeadSourceSummaryQueryDto,
  ): Promise<LeadSourceSummary> {
    const user = await this.currentUser.resolve();
    const points = await this.readPoints(user, query);

    // Local midnight to measure days from. `from` is the client's own period start
    // and `todayStart` its local midnight (ADR-0028 §3), so both land on a real local
    // day boundary and day N is simply anchor + N × 24h.
    const anchor = new Date(query.from ?? query.todayStart);
    const dayOf = (at: Date): number =>
      Math.floor((at.getTime() - anchor.getTime()) / DAY_MS);

    const window = this.dayWindow(query, points, anchor, dayOf);
    const dates: string[] = [];
    for (let day = window.first; day <= window.last; day += 1) {
      dates.push(new Date(anchor.getTime() + day * DAY_MS).toISOString());
    }

    // source -> day index -> the distinct leads seen. A Set, because Assigned mode
    // reads one row per assignment and the same lead can appear several times.
    const grid = new Map<string, Map<number, Set<string>>>();
    for (const point of points) {
      const day = dayOf(point.at);
      if (day < window.first || day > window.last) continue;
      const source =
        point.source && point.source.trim() !== ''
          ? point.source
          : NO_SOURCE_LABEL;
      let byDay = grid.get(source);
      if (!byDay) {
        byDay = new Map<number, Set<string>>();
        grid.set(source, byDay);
      }
      let leads = byDay.get(day);
      if (!leads) {
        leads = new Set<string>();
        byDay.set(day, leads);
      }
      leads.add(point.leadId);
    }

    const sources: LeadSourceRow[] = [...grid.entries()]
      .map(([source, byDay]) => {
        const values = dates.map(
          (_, index) => byDay.get(window.first + index)?.size ?? 0,
        );
        return {
          source,
          values,
          total: values.reduce((sum, value) => sum + value, 0),
        };
      })
      // The reference's row order: alphabetical, with "No Source" last — the same
      // ordering the Leads By Source report already established.
      .sort(
        (a, b) =>
          Number(a.source === NO_SOURCE_LABEL) -
            Number(b.source === NO_SOURCE_LABEL) ||
          a.source.localeCompare(b.source, undefined, { sensitivity: 'base' }),
      );

    const dailyTotals = dates.map((_, index) =>
      sources.reduce((sum, row) => sum + row.values[index], 0),
    );

    return {
      dates,
      sources,
      dailyTotals,
      // Summed from the same cells the matrix prints, so the donut's centre and the
      // Total row can never disagree with the grid above them.
      grandTotal: dailyTotals.reduce((sum, value) => sum + value, 0),
      truncated: points.length >= MAX_SCAN_ROWS,
    };
  }

  /** The scoped records for the selected date dimension, two columns wide. */
  private async readPoints(
    user: CurrentUser,
    query: LeadSourceSummaryQueryDto,
  ): Promise<Point[]> {
    const window = periodFilter(query);

    if (query.mode === 'assigned') {
      const rows = await this.prisma.leadAssignment.findMany({
        where: {
          lead: leadScopeWhere(user),
          ...(window ? { createdAt: window } : {}),
        },
        select: {
          leadId: true,
          createdAt: true,
          lead: { select: { source: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_SCAN_ROWS,
      });
      return rows.map((row) => ({
        at: row.createdAt,
        source: row.lead.source,
        leadId: row.leadId,
      }));
    }

    const rows = await this.prisma.lead.findMany({
      where: {
        ...leadScopeWhere(user),
        ...(window ? { createdAt: window } : {}),
      },
      select: { id: true, createdAt: true, source: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_SCAN_ROWS,
    });
    return rows.map((row) => ({
      at: row.createdAt,
      source: row.source,
      leadId: row.id,
    }));
  }

  /**
   * Which day indices become columns.
   *
   * A bounded period gets **every** day in it, data or not — the reference shows
   * empty columns inside the month (Sep 01 and Sep 02 carry nothing). The All preset
   * has no bounds to enumerate, so it spans the data itself, keeping the most recent
   * `MAX_DAY_COLUMNS` days.
   */
  private dayWindow(
    query: LeadSourceSummaryQueryDto,
    points: Point[],
    anchor: Date,
    dayOf: (at: Date) => number,
  ): { first: number; last: number } {
    if (query.from && query.to) {
      const first = 0; // the anchor IS `from`
      // `to` is exclusive, so the last column is the day before it. A window shorter
      // than a day still yields its one day.
      const last = Math.max(
        first,
        Math.ceil((new Date(query.to).getTime() - anchor.getTime()) / DAY_MS) -
          1,
      );
      return { first, last: Math.min(last, first + MAX_DAY_COLUMNS - 1) };
    }

    if (points.length === 0) {
      // Nothing to span: one column, the caller's today, so the grid keeps its shape.
      const today = dayOf(new Date(query.todayStart));
      return { first: today, last: today };
    }

    const days = points.map((point) => dayOf(point.at));
    const last = Math.max(...days);
    const first = Math.max(Math.min(...days), last - MAX_DAY_COLUMNS + 1);
    return { first, last };
  }
}
