import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';

/** The filters the Duplicate Enquiries report (RPT-02.10) accepts, already parsed. */
export interface DuplicateEnquiriesFilters {
  /** The enquiry window's bounds, applied to the lead's creation date. */
  from?: string;
  to?: string;
  /** Assigned-agent user ids — matched through the assignment join. */
  agent?: string[];
  /** Lead source values — exact match. */
  source?: string[];
}

/**
 * The one scoped `where` the report's cards and table compose (RPT-02.10).
 *
 * Role scope, soft-delete, the enquiry window, the agent and the source all come from the
 * leads module's `buildLeadWhere` — the same tested fragments every other report reuses.
 * The duplicate rule itself is not here: it is a grouping over this population, applied by
 * the service, so the filters decide which leads are compared in the first place.
 */
export function buildDuplicateEnquiriesWhere(
  user: CurrentUser,
  filters: DuplicateEnquiriesFilters,
): Prisma.LeadWhereInput {
  return buildLeadWhere(user, {
    createdFrom: filters.from,
    createdTo: filters.to,
    assignedAgent: filters.agent,
    source: filters.source,
  });
}
