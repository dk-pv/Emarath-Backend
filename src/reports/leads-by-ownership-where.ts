import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';
import { teamWhere } from './leads-by-status-where';

/** The filters the Leads By Ownership report (RPT-02.5) accepts, already parsed. */
export interface LeadsByOwnershipFilters {
  /** Team names (RPT-02.5 AC3) — matched through the assignee's `User.team`. */
  team?: string[];
  /**
   * The creation-window lower bound (RPT-02.5 "period"), an ISO instant the client
   * computes in its own timezone. A lead qualifies only if it was created on/after this
   * instant. Absent means "any time" — the whole role-scoped set.
   */
  from?: string;
  /** Optional upper bound of the creation window; rarely set (the UI sends only `from`). */
  to?: string;
}

/**
 * The one scoped `where` the report's list, summary and export all compose.
 *
 * Role scope + soft-delete + the creation window come from the leads module's
 * `buildLeadWhere` (period → `createdFrom`/`createdTo`), and the team predicate reuses the
 * `teamWhere` fragment RPT-02.3 defined — so the report can never leak a lead outside the
 * caller's scope (AC4). The ownership dimension itself is applied by the service's per-assignee
 * aggregation, not here, so this `where` matches "period + team" over the visible leads.
 */
export function buildLeadsByOwnershipWhere(
  user: CurrentUser,
  filters: LeadsByOwnershipFilters,
): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [
    buildLeadWhere(user, { createdFrom: filters.from, createdTo: filters.to }),
  ];
  if (filters.team?.length) conditions.push(teamWhere(filters.team));

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
