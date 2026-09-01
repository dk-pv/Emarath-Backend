import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';
import { LOST_STATUS } from '../leads/lead-status.constants';

/** The filters the Lead Aging & Stale Leads report (RPT-02.8) accepts, already parsed. */
export interface LeadAgingFilters {
  /** Assigned-agent user ids — matched through the assignment join. */
  agent?: string[];
  /** Lead status names to narrow to. */
  status?: string[];
  /** Only leads with no assignee. */
  unassigned?: boolean;
  /** The creation window's bounds (the breakdown's period dropdown). */
  from?: string;
  to?: string;
  /** Track closed-lost leads too; off by default, as the reference's checkbox is. */
  includeLost?: boolean;
  /** One agent to narrow to on top of `agent` — the breakdown's row click. */
  owner?: string;
}

/**
 * The one scoped `where` the report's KPIs, breakdown, details and export all compose.
 *
 * Role scope + soft-delete + the agent/status/window filters come from the leads module's
 * `buildLeadWhere` — the exact, tested fragments every other report reuses. The report adds
 * only its own rule: a closed-lost lead is not "aging" (nobody is going to work it again),
 * so LOST is excluded unless the caller asks for it.
 */
export function buildLeadAgingWhere(
  user: CurrentUser,
  filters: LeadAgingFilters,
): Prisma.LeadWhereInput {
  const scoped = buildLeadWhere(user, {
    assignedAgent: filters.agent,
    status: filters.status,
    unassigned: filters.unassigned,
    createdFrom: filters.from,
    createdTo: filters.to,
  });
  const conditions: Prisma.LeadWhereInput[] = [scoped];
  if (!filters.includeLost) {
    conditions.push({ NOT: { status: LOST_STATUS } });
  }
  // ANDed, not merged into `agent`: that param is an OR over the toolbar's picks, so a
  // row click must intersect it rather than widen or replace it.
  if (filters.owner) {
    conditions.push({ assignments: { some: { userId: filters.owner } } });
  }
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
