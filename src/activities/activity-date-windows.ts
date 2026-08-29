import { Prisma } from '../generated/prisma/client';

/**
 * The Workpex Activities filter popup's quick date checkboxes. Distinct from the
 * worklist tabs (`ACTIVITY_BUCKETS`): a tab selects one triage view, these narrow
 * whatever tab is open, and several may be ticked at once.
 */
export const ACTIVITY_DATE_WINDOWS = [
  'overdue',
  'today',
  'tomorrow',
  'yesterday',
  'thisWeek',
  'thisMonth',
] as const;

export type ActivityDateWindow = (typeof ACTIVITY_DATE_WINDOWS)[number];

/**
 * Window edges as ISO instants, computed by the client in its own timezone and sent
 * with the query — the same contract the tab boundaries already use (ADR-0028 §3),
 * so "this week" means the user's week rather than the server's. `todayStart`,
 * `todayEnd` and `tomorrowEnd` are the required tab boundaries; the rest arrive only
 * when the matching checkbox is ticked, so a window with no edges adds no condition.
 */
export interface ActivityWindowEdges {
  todayStart: Date;
  todayEnd: Date;
  tomorrowEnd: Date;
  yesterdayStart?: Date;
  weekStart?: Date;
  weekEnd?: Date;
  monthStart?: Date;
  monthEnd?: Date;
}

/** A half-open `[from, to)` due-date range, or undefined when an edge is missing. */
function range(
  from: Date | undefined,
  to: Date | undefined,
): Prisma.ActivityWhereInput | undefined {
  if (!from || !to) return undefined;
  return { dueAt: { gte: from, lt: to } };
}

/**
 * One quick-date checkbox as a predicate.
 *
 * Every window except Overdue is a pure due-date range: on the All or Completed tab
 * "Today" means everything due today, done or not, and the open/done split is the
 * tab's job. Overdue is the exception — a completed item is never overdue — so it
 * keeps the `completedAt: null` half its tab predicate has.
 */
function windowWhere(
  window: ActivityDateWindow,
  edges: ActivityWindowEdges,
): Prisma.ActivityWhereInput | undefined {
  switch (window) {
    case 'overdue':
      return { completedAt: null, dueAt: { lt: edges.todayStart } };
    case 'today':
      return range(edges.todayStart, edges.todayEnd);
    case 'tomorrow':
      return range(edges.todayEnd, edges.tomorrowEnd);
    case 'yesterday':
      return range(edges.yesterdayStart, edges.todayStart);
    case 'thisWeek':
      return range(edges.weekStart, edges.weekEnd);
    case 'thisMonth':
      return range(edges.monthStart, edges.monthEnd);
  }
}

/**
 * The ticked quick-date checkboxes as ONE condition (ACT-07.1 AC2).
 *
 * The windows OR together — ticking Today and Tomorrow asks for either, not both at
 * once, which no activity could satisfy — and the service ANDs the result with the
 * tab, scope, search and the other filters. Returns undefined when nothing is ticked
 * so an empty selection adds no condition (AC5).
 */
export function activityDateWindowWhere(
  windows: readonly ActivityDateWindow[] | undefined,
  edges: ActivityWindowEdges,
): Prisma.ActivityWhereInput | undefined {
  if (!windows?.length) return undefined;

  const or = windows
    .map((window) => windowWhere(window, edges))
    .filter((where): where is Prisma.ActivityWhereInput => where !== undefined);

  if (or.length === 0) return undefined;
  return or.length === 1 ? or[0] : { OR: or };
}

/**
 * The explicit From/To date range (the popup's two calendar fields), independent of
 * the checkboxes and ANDed with them. Either end may stand alone — a From with no To
 * is "on or after", a To with no From is "before" — so a half-filled range still
 * filters rather than being ignored.
 */
export function activityDueRangeWhere(
  from: Date | undefined,
  to: Date | undefined,
): Prisma.ActivityWhereInput | undefined {
  if (!from && !to) return undefined;
  return {
    dueAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: to } : {}),
    },
  };
}
