import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';

/** The filters the Leads By Status report (RPT-02.3) accepts, already parsed. */
export interface LeadsByStatusFilters {
  /** Team names (RPT-02.3 AC3) — matched through the assignee's `User.team`. */
  team?: string[];
  /**
   * The creation-window lower bound (RPT-02.3 "period"), an ISO instant the client
   * computes in its own timezone. A lead qualifies only if it was created on/after this
   * instant. Absent means "any time" — the whole role-scoped set.
   */
  from?: string;
  /** Optional upper bound of the creation window; rarely set (the UI sends only `from`). */
  to?: string;
}

/**
 * "Belongs to one of these teams" as a query fragment (RPT-02.3 AC3).
 *
 * A lead matches when it is assigned to a user whose `team` is selected — the same
 * assignee-team shape the manager role scope uses (`leadScopeWhere`). `some` compiles to
 * EXISTS. Kept in the reports module so the leads module's filter set is not modified.
 */
export function teamWhere(teams: string[]): Prisma.LeadWhereInput {
  return { assignments: { some: { user: { team: { in: teams } } } } };
}

/**
 * The one scoped `where` the report's list, summary and export all compose.
 *
 * Role scope + soft-delete + the creation window come from the leads module's
 * `buildLeadWhere` (period → `createdFrom`/`createdTo`) — the exact, tested fragments the
 * Leads list uses — so the report can never leak a lead outside the caller's scope (AC4).
 * The report adds only the team predicate on top.
 */
export function buildLeadsByStatusWhere(
  user: CurrentUser,
  filters: LeadsByStatusFilters,
): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [
    buildLeadWhere(user, { createdFrom: filters.from, createdTo: filters.to }),
  ];
  if (filters.team?.length) conditions.push(teamWhere(filters.team));

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
