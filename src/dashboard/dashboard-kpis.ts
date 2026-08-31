import { CallDirection, Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { activityScopeWhere } from '../activities/activity-scope';
import { activityDueRangeWhere } from '../activities/activity-date-windows';
import { buildOverdueFollowUpsWhere } from '../reports/overdue-follow-ups-where';
import { buildLeadWhere } from '../leads/lead-where';
import { leadScopeWhere } from '../leads/lead-scope';
import { callScopeWhere } from '../calls/call-scope';

/** The six top-of-dashboard counters (DASH-02.1 AC1). */
export const KPI_KEYS = [
  'overdueFollowUps',
  'hotLeads',
  'todaysLeads',
  'todaysFollowUps',
  'qualifiedLeads',
  'outboundCalls',
] as const;

export type KpiKey = (typeof KPI_KEYS)[number];

/**
 * One counter's value.
 *
 * `value` is nullable on purpose: a counter whose business rule has not been
 * agreed reports `pending-definition` rather than a fabricated number. Only
 * `qualifiedLeads` is in that state today (see `QUALIFIED_LEADS_PENDING`).
 */
export interface KpiCounter {
  value: number | null;
  status: 'ok' | 'pending-definition';
  /** Why the value is null. Present only for `pending-definition`. */
  reason?: string;
}

/**
 * Qualified Leads has **no definition and no data backing**. The Workpex card
 * reads "Leads in Qualified Status", but no `Qualified` status exists — not among
 * the lead statuses in use, not in `stages`, nowhere in the schema.
 *
 * Owner ruling (2026-08-29): do not invent one, and do not silently map it onto
 * HOT / SUPER HOT / WON / Converted or any other status. The counter reports its
 * pending state explicitly so the UI can render it as unavailable and the gap
 * stays visible instead of becoming a wrong number nobody questions.
 */
export const QUALIFIED_LEADS_PENDING: KpiCounter = {
  value: null,
  status: 'pending-definition',
  reason:
    'No "Qualified" lead status exists yet. Awaiting the Product Owner definition.',
};

/**
 * The statuses that count as a hot lead (owner ruling 2026-08-29) — the Workpex
 * card's "leads with high conversion potential". These are the canonical status
 * values already in use; nothing here creates or alters a status.
 */
export const HOT_LEAD_STATUSES = ['HOT', 'SUPER HOT'];

/**
 * The window a counter covers: the widget's own selected period, as ISO instants
 * the client computes in its own timezone (ADR-0028 §3), `to` exclusive. Both are
 * absent for the "All" preset, which means "no date predicate".
 *
 * `todayStart` is the caller's local midnight and is always required — "overdue"
 * is meaningless without the caller's own today, exactly as the Activities
 * worklist and the Overdue Follow Ups report already require it.
 */
export interface KpiPeriod {
  todayStart: string;
  from?: string;
  to?: string;
}

const asDate = (iso: string | undefined): Date | undefined =>
  iso === undefined ? undefined : new Date(iso);

/**
 * Overdue Follow-ups — reused **verbatim** from the Overdue Follow Ups report, so
 * the dashboard counter and that report can never disagree. That helper composes
 * the Activities role scope and the worklist's own overdue predicate
 * (`completedAt IS NULL AND dueAt < todayStart` via `activityBucketWhere`), and
 * applies the period to `createdAt` — "follow-ups created in the period that are
 * currently overdue", the established convention across every RPT-0x report.
 */
export function overdueFollowUpsWhere(
  user: CurrentUser,
  period: KpiPeriod,
): Prisma.ActivityWhereInput {
  return buildOverdueFollowUpsWhere(user, {
    todayStart: period.todayStart,
    from: period.from,
    to: period.to,
  });
}

/**
 * Today's Follow-ups — follow-ups **due** inside the selected period, scoped by
 * role. Due date, never call activity (owner ruling 2026-08-29).
 *
 * `completedAt: null` is the same open-item rule `activityBucketWhere` applies to
 * its Overdue/Today/Tomorrow tabs, so with the period set to the caller's today
 * this counter equals the Activities worklist's "Today" tab exactly. The due
 * window itself reuses `activityDueRangeWhere`.
 */
export function todaysFollowUpsWhere(
  user: CurrentUser,
  period: KpiPeriod,
): Prisma.ActivityWhereInput {
  const conditions: Prisma.ActivityWhereInput[] = [
    activityScopeWhere(user),
    { completedAt: null },
  ];
  const due = activityDueRangeWhere(asDate(period.from), asDate(period.to));
  if (due) conditions.push(due);
  return { AND: conditions };
}

/**
 * Today's Leads — leads **assigned** during the period (owner ruling 2026-08-29),
 * which is the `LeadAssignment.createdAt` the Leads filter builder already exposes
 * as `assignedDate`.
 *
 * Deliberately NOT the RPT-02.2 `buildTodayLeadsWhere`: that report means
 * "recently contacted" (the lead has a Call in the window), a different metric
 * that merely shares a name. Reusing it here would report the wrong number.
 *
 * Role scope comes from `leadScopeWhere`, so an agent counts only their own leads.
 */
export function todaysLeadsWhere(
  user: CurrentUser,
  period: KpiPeriod,
): Prisma.LeadWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (period.from) createdAt.gte = new Date(period.from);
  if (period.to) createdAt.lt = new Date(period.to);

  return {
    AND: [
      leadScopeWhere(user),
      {
        assignments: {
          some: period.from || period.to ? { createdAt } : {},
        },
      },
    ],
  };
}

/**
 * Hot Leads — leads whose canonical status is HOT or SUPER HOT (owner ruling
 * 2026-08-29). Composed through `buildLeadWhere`, so role scope, soft-delete and
 * the status predicate are the exact fragments the Leads list uses; the period
 * applies to `createdAt`, the convention every leads report follows.
 */
export function hotLeadsWhere(
  user: CurrentUser,
  period: KpiPeriod,
): Prisma.LeadWhereInput {
  return buildLeadWhere(user, {
    status: HOT_LEAD_STATUSES,
    createdFrom: period.from,
    createdTo: period.to,
  });
}

/**
 * Outbound Calls — calls placed in the period, scoped by role through
 * `callScopeWhere` (which delegates to `leadScopeWhere`). The same direction
 * predicate and the same scope the Call Dashboard's own summary uses, so the two
 * surfaces report the same figure for the same window.
 */
export function outboundCallsWhere(
  user: CurrentUser,
  period: KpiPeriod,
): Prisma.CallWhereInput {
  const startedAt: Prisma.DateTimeFilter = {};
  if (period.from) startedAt.gte = new Date(period.from);
  if (period.to) startedAt.lt = new Date(period.to);

  return {
    ...callScopeWhere(user),
    direction: CallDirection.OUTBOUND,
    ...(period.from || period.to ? { startedAt } : {}),
  };
}
