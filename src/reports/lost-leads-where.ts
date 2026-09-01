import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';
import { LOST_STATUS } from '../leads/lead-status.constants';
import { teamWhere } from './leads-by-status-where';

export { LOST_STATUS } from '../leads/lead-status.constants';

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
  /** Optional upper bound of the window. */
  to?: string;
  /** Which date the window applies to; `statusChanged` reads `Lead.statusChangedAt` — for a LOST lead, when it was lost. */
  dateField?: 'created' | 'statusChanged';
  /** Assigned-agent user ids — matched through the assignment join. */
  agent?: string[];
  /** Lead source values to narrow to (exact match). */
  source?: string[];
  /** One exact board name. */
  pipeline?: string;
  /** The condition builder's JSON payload, whitelisted by the leads module. */
  conditions?: string;
  /** Lost-reason buckets (`NO_REASON_VALUE` = lost with no recorded reason). */
  reason?: string[];
}

/** The drill value for the null bucket — leads lost before reasons existed, or skipped. */
export const NO_REASON_VALUE = 'none';

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
  const byStatusChange = filters.dateField === 'statusChanged';
  const conditions: Prisma.LeadWhereInput[] = [
    buildLeadWhere(user, {
      status: [LOST_STATUS],
      source: filters.source,
      assignedAgent: filters.agent,
      pipeline: filters.pipeline,
      conditions: filters.conditions,
      createdFrom: byStatusChange ? undefined : filters.from,
      createdTo: byStatusChange ? undefined : filters.to,
    }),
  ];
  if (filters.team?.length) conditions.push(teamWhere(filters.team));
  if (filters.reason?.length) {
    conditions.push({
      OR: filters.reason.map((reason) =>
        reason === NO_REASON_VALUE
          ? { lostReason: null }
          : { lostReason: reason },
      ),
    });
  }
  // "Lost Date": the same half-open [from, to) window, on the column the
  // `leads_status_changed_at` trigger keeps current — when the lead became LOST.
  if (byStatusChange && (filters.from || filters.to)) {
    conditions.push({
      statusChangedAt: {
        gte: filters.from ? new Date(filters.from) : undefined,
        lt: filters.to ? new Date(filters.to) : undefined,
      },
    });
  }
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
