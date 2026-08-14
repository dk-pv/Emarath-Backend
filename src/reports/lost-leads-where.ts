import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';
import { teamWhere } from './leads-by-status-where';

/**
 * The lead status that means "lost" (RPT-02.7, approved definition B1 — Workpex parity). Workpex's
 * own Lost Leads report lists leads whose Lead Status is exactly "LOST"
 * (`ui-reference/reports/converted and lost leads overview video.mp4`), and no loss-reason field
 * exists in the model or the reference. Deliberately a single status: NOT ANSWER / NOT REACHEBLE /
 * Cancel / SALES REJECTED / QC NOT APPROVED are NOT treated as lost.
 */
export const LOST_STATUS = 'LOST';

/** The filters the Lost Leads report (RPT-02.7) accepts, already parsed. */
export interface LostLeadsFilters {
  /** Team names (RPT-02.7 AC3) — matched through the assignee's `User.team`. */
  team?: string[];
  /**
   * The creation-window lower bound (RPT-02.7 "period"), an ISO instant the client computes in
   * its own timezone. There is no `lostAt`/status-history field, so the period filters
   * `createdAt` — "leads created on/after this instant that are currently LOST". Absent means
   * "any time" — the whole role-scoped LOST set.
   */
  from?: string;
  /** Optional upper bound of the creation window; the UI sends only `from`. */
  to?: string;
}

/**
 * The one scoped `where` the report's list, summary and export all compose (RPT-02.7).
 *
 * Role scope + soft-delete + the createdAt period come from the leads module's `buildLeadWhere`,
 * with the fixed `status = LOST` predicate carried by the same builder — so the report can never
 * leak a lead outside the caller's scope (AC4) and never drifts from those filters. The team
 * predicate (reused `teamWhere`, the same assignee-team shape the manager scope uses) is ANDed on
 * top, matching RPT-02.3/02.4/02.5.
 */
export function buildLostLeadsWhere(
  user: CurrentUser,
  filters: LostLeadsFilters,
): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [
    buildLeadWhere(user, {
      status: [LOST_STATUS],
      createdFrom: filters.from,
      createdTo: filters.to,
    }),
  ];
  if (filters.team?.length) conditions.push(teamWhere(filters.team));

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
