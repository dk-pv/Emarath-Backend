import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { noEngagementWhere } from '../leads/lead-engagement-where';
import { buildLeadWhere } from '../leads/lead-where';

/** The filters the Lead First Response report (RPT-02.9) accepts, already parsed. */
export interface LeadFirstResponseFilters {
  search?: string;
  agent?: string[];
  source?: string[];
  /** Leads carrying an activity of these kinds. */
  activityType?: string[];
  /** The creation window's bounds. */
  from?: string;
  to?: string;
  /** Which records tab is active. */
  contact?: 'all' | 'contacted' | 'untouched';
  /**
   * Ids of the leads matching the "changed since creation" kinds, resolved by the caller:
   * Prisma cannot compare two columns in a `where`, so the service answers that in SQL and
   * passes the result here. Omitted, those kinds are skipped.
   */
  changedIds?: string[];
}

/**
 * "Leads carrying a record of this kind" — a lead-level predicate the database can
 * answer, not a claim about which record came first. The kinds are ORed, so picking two
 * widens the set the way a multi-select should.
 */
export function activityTypeWhere(
  types: string[] | undefined,
  changedIds?: string[],
): Prisma.LeadWhereInput | null {
  if (!types?.length) return null;

  const alternatives: Prisma.LeadWhereInput[] = [];
  if (types.includes('CALL')) {
    alternatives.push({
      OR: [
        { calls: { some: { deletedAt: null } } },
        { activities: { some: { deletedAt: null, type: 'CALL' } } },
      ],
    });
  }
  if (types.includes('NOTE')) {
    alternatives.push({ notes: { some: { deletedAt: null } } });
  }
  if (types.includes('FOLLOW_UP')) {
    alternatives.push({ activities: { some: { deletedAt: null } } });
  }
  // Emarath keeps no status or edit history, only the two timestamps the database
  // maintains, so "changed since creation" is the honest reading of both — a
  // column-to-column comparison the service resolves in SQL for us.
  if (
    changedIds !== undefined &&
    (types.includes('STATUS_CHANGED') || types.includes('LEAD_EDITED'))
  ) {
    alternatives.push({ id: { in: changedIds } });
  }

  if (alternatives.length === 0) return null;
  return alternatives.length === 1 ? alternatives[0] : { OR: alternatives };
}

/**
 * The one scoped `where` the report's cards, records and export all compose.
 *
 * Role scope, soft-delete, search, source, agent and the creation window come from the
 * leads module's `buildLeadWhere` — the same tested fragments the Leads list uses. The
 * report adds only its own two predicates: the records tab (contacted vs untouched, on
 * the shared engagement definition) and the activity-type narrowing.
 */
export function buildLeadFirstResponseWhere(
  user: CurrentUser,
  filters: LeadFirstResponseFilters,
): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [
    buildLeadWhere(user, {
      search: filters.search,
      source: filters.source,
      assignedAgent: filters.agent,
      createdFrom: filters.from,
      createdTo: filters.to,
    }),
  ];

  // "Contacted" is the negation of the shared no-engagement rule, so this report, No
  // Activity and Today Leads can never disagree about what counts as being worked.
  if (filters.contact === 'untouched') {
    conditions.push(noEngagementWhere());
  } else if (filters.contact === 'contacted') {
    conditions.push({ NOT: noEngagementWhere() });
  }

  const activity = activityTypeWhere(filters.activityType, filters.changedIds);
  if (activity) conditions.push(activity);

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
