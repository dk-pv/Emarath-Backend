import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';

/**
 * The lead status that means "successfully converted" (RPT-02.6, approved definition). This is
 * the exact value the shipped Leads "Converted Leads" quick filter already uses
 * (`lead-quick-filters.ts`); the report reuses it so the two never diverge. The catalogue also
 * carries a distinct "Converted" stage, deliberately NOT included per the approved decision.
 */
export const CONVERTED_STATUS = 'WON';

/** The filters the Converted Leads report (RPT-02.6) accepts, already parsed. */
export interface ConvertedLeadsFilters {
  /** Assigned-agent user ids (AC3) — matched through the assignment join. */
  agent?: string[];
  /** Lead source values (AC3) — exact match. */
  source?: string[];
  /**
   * The period's lower bound, an ISO instant the client computes in its own timezone. The
   * system has no conversion timestamp (no convertedAt / status history), so the period is the
   * lead's `createdAt` — i.e. "leads created on/after this instant that are currently WON"
   * (approved RPT-02.6 rule; the same createdAt window every other RPT-02.x report uses).
   */
  from?: string;
  /** Optional upper bound of the period; the UI sends only `from`. */
  to?: string;
}

/**
 * The one scoped `where` the report's list, summary and export all compose (RPT-02.6).
 *
 * Role scope + soft-delete + source + agent + the createdAt period all come from the leads
 * module's `buildLeadWhere` — the exact, tested fragments the Leads list and export use — so
 * the report can never leak a lead outside the caller's scope (AC4) and never drifts from those
 * filters. "Converted" is a fixed `status = WON` predicate carried by the same builder, so there
 * is no second definition to keep in sync.
 */
export function buildConvertedLeadsWhere(
  user: CurrentUser,
  filters: ConvertedLeadsFilters,
): Prisma.LeadWhereInput {
  return buildLeadWhere(user, {
    status: [CONVERTED_STATUS],
    source: filters.source,
    assignedAgent: filters.agent,
    createdFrom: filters.from,
    createdTo: filters.to,
  });
}
