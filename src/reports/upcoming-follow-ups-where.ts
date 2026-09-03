import { ActivityType, Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { activityScopeWhere } from '../activities/activity-scope';
import { activityFilterWhere } from '../activities/activity-filters';

/** The filters the Upcoming Follow Ups report (RPT-03.3) accepts, already parsed. */
export interface UpcomingFollowUpsFilters {
  /**
   * The client's next local midnight (ADR-0028 §3) — the floor "upcoming" starts at, so the
   * report begins with tomorrow exactly as the reference shows. Computed in the caller's own
   * timezone, like every other date boundary the Activities domain takes.
   */
  todayEnd: string;
  /**
   * The By Date window, as ISO instants. Unlike the Overdue report — whose rows are all in the
   * past, so its window filters the follow-up's creation date — this report is entirely about
   * when work falls due, so its window filters `dueAt`. A preset that lies in the past simply
   * intersects nothing, which is the honest answer rather than a surprising one.
   */
  from?: string;
  to?: string;
  /** Assignee user ids — the toolbar's "Sales Agent" filter. */
  agent?: string[];
  /** Lead pipeline values, matched on the linked lead. */
  pipeline?: string[];
  /** Follow-up types — the toolbar's "Follow Up Type" filter. */
  type?: ActivityType[];
}

/**
 * "Upcoming" as an activity query fragment: open, and due from tomorrow onward.
 *
 * The Activities worklist has no such tab — its `tomorrow` bucket is a single day, not every
 * future date — so this is the one Follow Ups predicate that cannot be lifted from
 * `activityBucketWhere`. It is deliberately the exact complement of the tabs that do exist:
 * overdue (`< todayStart`), today (`[todayStart, todayEnd)`) and this (`>= todayEnd`) partition
 * every open follow-up, with `tomorrow` a strict subset of this one.
 */
export function upcomingWhere(todayEnd: Date): Prisma.ActivityWhereInput {
  return { completedAt: null, dueAt: { gte: todayEnd } };
}

/** The half-open By Date window over the due date, or nothing when no period is set. */
function dueWindowWhere(
  from?: string,
  to?: string,
): Prisma.ActivityWhereInput | undefined {
  if (!from && !to) return undefined;
  const dueAt: { gte?: Date; lt?: Date } = {};
  if (from) dueAt.gte = new Date(from);
  if (to) dueAt.lt = new Date(to);
  return { dueAt };
}

/**
 * The one scoped `where` the report's list and export both compose (RPT-03.3).
 *
 * Role scope and soft-delete come from `activityScopeWhere`, and the agent/pipeline/type
 * predicates from the Activities module's own `activityFilterWhere` — never a second copy — so
 * the report can never leak an activity outside the caller's scope. The By Date window is ANDed
 * on top of the upcoming floor, so a window reaching into the past still cannot pull past-due
 * follow-ups into an "upcoming" report.
 */
export function buildUpcomingFollowUpsWhere(
  user: CurrentUser,
  filters: UpcomingFollowUpsFilters,
): Prisma.ActivityWhereInput {
  const conditions: Prisma.ActivityWhereInput[] = [
    activityScopeWhere(user),
    upcomingWhere(new Date(filters.todayEnd)),
    ...activityFilterWhere({
      assignedAgent: filters.agent,
      pipeline: filters.pipeline,
      type: filters.type,
    }),
  ];
  const window = dueWindowWhere(filters.from, filters.to);
  if (window) conditions.push(window);

  return { AND: conditions };
}
