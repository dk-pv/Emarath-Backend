import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { activityScopeWhere } from '../activities/activity-scope';
import {
  activityBucketWhere,
  DayBoundaries,
} from '../activities/activity-buckets';
import { activityFilterWhere } from '../activities/activity-filters';

/** The filters the Overdue Follow Ups report (RPT-03.2) accepts, already parsed. */
export interface OverdueFollowUpsFilters {
  /**
   * The client's local midnight (ADR-0028 §3) — the cutoff the overdue predicate uses
   * (`dueAt < todayStart`). Required: "overdue" is meaningless without the caller's own today,
   * so like the Activities worklist the client computes it in its own timezone and sends it.
   */
  todayStart: string;
  /** Assignee user ids (RPT-03.2 AC2) — matched through the assignee join. */
  agent?: string[];
  /** Team names (RPT-03.2 AC2) — matched through the assignee's `User.team`. */
  team?: string[];
  /**
   * The creation-window bounds (RPT-03.2 "period"), ISO instants the client computes in its own
   * timezone. There is no status-history field on Activity, so the period filters `createdAt`
   * ("follow-ups created in the period that are currently overdue"), matching every RPT-02.x
   * report. Absent means "any time" — the whole role-scoped overdue set.
   */
  from?: string;
  to?: string;
}

/**
 * "Assigned to one of these teams" as an activity query fragment (RPT-03.2 AC2) — the same
 * assignee-team shape the manager role scope uses (`activityScopeWhere`), mirroring the leads
 * reports' `teamWhere`. A report filter only; the Activities scope is not modified.
 */
export function activityTeamWhere(teams: string[]): Prisma.ActivityWhereInput {
  return { assignees: { some: { user: { team: { in: teams } } } } };
}

/** The half-open createdAt window, or nothing when no period is set. */
function createdAtWhere(
  from?: string,
  to?: string,
): Prisma.ActivityWhereInput | undefined {
  if (!from && !to) return undefined;
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lt = new Date(to);
  return { createdAt };
}

/**
 * The one scoped `where` the report's list, summary and export all compose (RPT-03.2).
 *
 * Reuses the Activities domain verbatim: role scope + soft-delete from `activityScopeWhere`, and
 * the overdue definition (`completedAt IS NULL AND dueAt < todayStart`) from
 * `activityBucketWhere('overdue', …)` — never a second copy. The agent filter reuses
 * `activityFilterWhere`; the period and team predicates are ANDed on top. So the report can never
 * leak an activity outside the caller's scope (AC4) and its figures reconcile with the Activities
 * module's overdue tab (AC3).
 */
export function buildOverdueFollowUpsWhere(
  user: CurrentUser,
  filters: OverdueFollowUpsFilters,
): Prisma.ActivityWhereInput {
  const todayStart = new Date(filters.todayStart);
  // Overdue reads only todayStart; the other boundaries are unused for this bucket.
  const boundaries: DayBoundaries = {
    todayStart,
    todayEnd: todayStart,
    tomorrowEnd: todayStart,
  };

  const conditions: Prisma.ActivityWhereInput[] = [
    activityScopeWhere(user),
    activityBucketWhere('overdue', boundaries),
    ...activityFilterWhere({ assignedAgent: filters.agent }),
  ];
  const created = createdAtWhere(filters.from, filters.to);
  if (created) conditions.push(created);
  if (filters.team?.length) conditions.push(activityTeamWhere(filters.team));

  return { AND: conditions };
}
