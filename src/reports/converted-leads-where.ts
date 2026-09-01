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
  /** Optional upper bound of the period. */
  to?: string;
  /** Which date the window applies to; `statusChanged` reads `Lead.statusChangedAt` — for a WON lead, its conversion instant. */
  dateField?: 'created' | 'statusChanged';
  /** One exact board name. */
  pipeline?: string;
  /** The condition builder's JSON payload, whitelisted by the leads module. */
  conditions?: string;
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
  const byStatusChange = filters.dateField === 'statusChanged';
  const base = buildLeadWhere(user, {
    status: [CONVERTED_STATUS],
    source: filters.source,
    assignedAgent: filters.agent,
    pipeline: filters.pipeline,
    conditions: filters.conditions,
    createdFrom: byStatusChange ? undefined : filters.from,
    createdTo: byStatusChange ? undefined : filters.to,
  });
  if (!byStatusChange || !(filters.from || filters.to)) return base;
  // "Converted Date": the same half-open [from, to) window, on the column the
  // `leads_status_changed_at` trigger keeps current — when the lead became WON.
  return {
    AND: [
      base,
      {
        statusChangedAt: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lt: filters.to ? new Date(filters.to) : undefined,
        },
      },
    ],
  };
}
