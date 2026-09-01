import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';
import { teamWhere } from './leads-by-status-where';

/** The filters the Leads By Source report (RPT-02.4) accepts, already parsed. */
export interface LeadsBySourceFilters {
  /** Team names (RPT-02.4 AC3) — matched through the assignee's `User.team`. */
  team?: string[];
  /**
   * The creation-window lower bound (RPT-02.4 "period"), an ISO instant the client
   * computes in its own timezone. A lead qualifies only if it was created on/after this
   * instant. Absent means "any time" — the whole role-scoped set.
   */
  from?: string;
  /** Optional upper bound of the window. */
  to?: string;
  /** Which date the window applies to; `statusChanged` reads `Lead.statusChangedAt`. */
  dateField?: 'created' | 'statusChanged';
  /** Assigned-agent user ids — matched through the assignment join. */
  agent?: string[];
  /** Lead source values to narrow to (exact match). */
  source?: string[];
  /** One exact board name. */
  pipeline?: string;
  /** The condition builder's JSON payload, whitelisted by the leads module. */
  conditions?: string;
}

/**
 * The one scoped `where` the report's list, summary and export all compose.
 *
 * Role scope + soft-delete + the creation window come from the leads module's
 * `buildLeadWhere` (period → `createdFrom`/`createdTo`), and the team predicate reuses the
 * `teamWhere` fragment RPT-02.3 already defined — so the report can never leak a lead outside
 * the caller's scope (AC4) and never drifts from those filters. The source dimension itself is
 * applied by the service's `groupBy`, not here, so this `where` matches "period + team".
 */
export function buildLeadsBySourceWhere(
  user: CurrentUser,
  filters: LeadsBySourceFilters,
): Prisma.LeadWhereInput {
  const byStatusChange = filters.dateField === 'statusChanged';
  const conditions: Prisma.LeadWhereInput[] = [
    buildLeadWhere(user, {
      createdFrom: byStatusChange ? undefined : filters.from,
      createdTo: byStatusChange ? undefined : filters.to,
      source: filters.source,
      assignedAgent: filters.agent,
      pipeline: filters.pipeline,
      conditions: filters.conditions,
    }),
  ];
  if (filters.team?.length) conditions.push(teamWhere(filters.team));
  // "Status Changed Date": the same half-open [from, to) window, on the column the
  // `leads_status_changed_at` trigger keeps current.
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
