import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';

/** The filters the No Activity Leads report (RPT-02.1) accepts, already parsed. */
export interface NoActivityFilters {
  /** Assigned-agent user ids (RPT-02.1 AC2) — matched through the assignment join. */
  agent?: string[];
  /** Lead source values (RPT-02.1 AC2) — exact match. */
  source?: string[];
  /**
   * The recency window's lower bound (RPT-02.1 AC2 "period"), an ISO instant the
   * client computes in its own timezone. A lead qualifies only if it has NO completed
   * activity on/after this instant — i.e. it has gone quiet since then. Absent means
   * "any time": the lead has no completed activity at all (never engaged).
   */
  from?: string;
  /** Optional upper bound of the recency window; rarely set (the UI sends only `from`). */
  to?: string;
}

/**
 * "No recent activity" as a query fragment (RPT-02.1, definition B).
 *
 * A lead is a No-Activity Lead when it has NO non-deleted activity whose `completedAt`
 * falls in the selected window — `completedAt` because a *completed* follow-up is the
 * signal that real engagement happened (a merely scheduled or overdue-but-undone activity
 * is not engagement). `none` compiles to NOT EXISTS, so the test runs in the database and
 * is backed by `@@index([leadId, deletedAt])` + `@@index([completedAt])`. With no window
 * this reads "has never completed any activity", which is the report's default view.
 *
 * The lead's own `deletedAt` and role scope are NOT applied here — they come from
 * `buildLeadWhere`, which this is ANDed with. Keeping the two apart means the activity
 * predicate can never be mistaken for the lead's visibility rule.
 */
export function noRecentActivityWhere(
  filters: NoActivityFilters,
): Prisma.LeadWhereInput {
  const completedAt: Prisma.DateTimeNullableFilter = { not: null };
  if (filters.from) completedAt.gte = new Date(filters.from);
  if (filters.to) completedAt.lt = new Date(filters.to);

  return { activities: { none: { deletedAt: null, completedAt } } };
}

/**
 * The one scoped `where` the report's list, summary and export all compose.
 *
 * Role scope + soft-delete + source + agent come from the leads module's `buildLeadWhere`
 * — the exact, tested fragments the Leads list and export use — so the report can never
 * leak a lead outside the caller's scope (AC4) and never drifts from those filters. The
 * report adds only its own "no recent activity" predicate on top.
 */
export function buildNoActivityWhere(
  user: CurrentUser,
  filters: NoActivityFilters,
): Prisma.LeadWhereInput {
  return {
    AND: [
      buildLeadWhere(user, {
        source: filters.source,
        assignedAgent: filters.agent,
      }),
      noRecentActivityWhere(filters),
    ],
  };
}
