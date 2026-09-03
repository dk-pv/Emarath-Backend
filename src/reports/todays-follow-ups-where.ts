import { ActivityType, Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { activityScopeWhere } from '../activities/activity-scope';
import {
  activityBucketWhere,
  DayBoundaries,
} from '../activities/activity-buckets';
import { activityFilterWhere } from '../activities/activity-filters';

/** The filters the Today's Follow Ups report (RPT-03.1) accepts, already parsed. */
export interface TodaysFollowUpsFilters {
  /**
   * The client's local midnight and the next one (ADR-0028 §3). "Today" is a half-open window,
   * so unlike Overdue's single cutoff both edges are required: the client computes them in its
   * own timezone, exactly as the Activities worklist does, so the day is the user's day.
   */
  todayStart: string;
  todayEnd: string;
  /** Assignee user ids — the toolbar's "Sales Agent" filter. */
  agent?: string[];
  /** Lead pipeline values, matched on the linked lead. */
  pipeline?: string[];
  /** Follow-up types — the toolbar's "Follow Up Type" filter. */
  type?: ActivityType[];
}

/**
 * The one scoped `where` the report's list and export both compose (RPT-03.1).
 *
 * Reuses the Activities domain verbatim: role scope + soft-delete from `activityScopeWhere`, and
 * the today definition (`completedAt IS NULL AND dueAt >= todayStart AND dueAt < todayEnd`) from
 * `activityBucketWhere('today', …)` — never a second copy, so the report's figures reconcile with
 * the Activities worklist's Today tab. The agent/pipeline/type predicates are the Activities
 * module's own `activityFilterWhere` fragments, so the report can never leak an activity outside
 * the caller's scope.
 */
export function buildTodaysFollowUpsWhere(
  user: CurrentUser,
  filters: TodaysFollowUpsFilters,
): Prisma.ActivityWhereInput {
  const todayStart = new Date(filters.todayStart);
  const todayEnd = new Date(filters.todayEnd);
  // Today reads only the first two boundaries; tomorrowEnd is unused for this bucket.
  const boundaries: DayBoundaries = {
    todayStart,
    todayEnd,
    tomorrowEnd: todayEnd,
  };

  return {
    AND: [
      activityScopeWhere(user),
      activityBucketWhere('today', boundaries),
      ...activityFilterWhere({
        assignedAgent: filters.agent,
        pipeline: filters.pipeline,
        type: filters.type,
      }),
    ],
  };
}
