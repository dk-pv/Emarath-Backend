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
  /**
   * Which date the window applies to; `statusChanged` reads `Lead.statusChangedAt`, and
   * `orderCreated` the lead's Logistics order's `convertedAt` — when it was won and its order
   * created — so a lead with no order is outside any such window.
   */
  dateField?: 'created' | 'statusChanged' | 'orderCreated';
  /** Assigned-agent user ids — matched through the assignment join. */
  agent?: string[];
  /** Lead source values to narrow to (exact match). */
  source?: string[];
  /** One exact board name. */
  pipeline?: string;
  /** The condition builder's JSON payload, whitelisted by the leads module. */
  conditions?: string;
  /** Only leads with no assignee — what the legend's "Unassigned" slice drills into. */
  unassigned?: boolean;
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
  const byCreation = !filters.dateField || filters.dateField === 'created';
  const conditions: Prisma.LeadWhereInput[] = [
    buildLeadWhere(user, {
      createdFrom: byCreation ? filters.from : undefined,
      createdTo: byCreation ? filters.to : undefined,
      source: filters.source,
      assignedAgent: filters.agent,
      pipeline: filters.pipeline,
      conditions: filters.conditions,
      unassigned: filters.unassigned,
    }),
  ];
  if (filters.team?.length) conditions.push(teamWhere(filters.team));
  if (!byCreation && (filters.from || filters.to)) {
    const window = {
      gte: filters.from ? new Date(filters.from) : undefined,
      lt: filters.to ? new Date(filters.to) : undefined,
    };
    conditions.push(
      filters.dateField === 'statusChanged'
        ? { statusChangedAt: window }
        : { logisticsOrder: { is: { convertedAt: window } } },
    );
  }
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
