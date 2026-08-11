import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from '../leads/lead-where';

/** The filters the Today Leads report (RPT-02.2) accepts, already parsed. */
export interface TodayLeadsFilters {
  /** Assigned-agent user ids (RPT-02.2 AC2) — matched through the assignment join. */
  agent?: string[];
  /** Lead source values (RPT-02.2 AC2) — exact match. */
  source?: string[];
  /**
   * The contact window's lower bound (RPT-02.2 "period"), an ISO instant the client
   * computes in its own timezone — so "today" is the user's day, not the server's
   * (ADR-0028 §3, the same rule the Activities "today" bucket follows). A lead qualifies
   * only if it was contacted (a Call) on/after this instant. Absent means "ever contacted":
   * the backend never invents a server-timezone "today".
   */
  from?: string;
  /** Optional upper bound of the contact window; rarely set (the UI sends only `from`). */
  to?: string;
}

/**
 * "Recently contacted" as a query fragment (RPT-02.2, definition A — decided with the
 * product owner over the Lead's own outreach counters, which carry no timestamp).
 *
 * A lead is a Today Lead when it has at least one non-deleted `Call` whose `startedAt`
 * falls in the selected window — a Call row (CALL-01.1) is the only timestamped record of
 * an actual contact event, so it is the honest signal for "recently contacted". `some`
 * compiles to EXISTS, so the test runs in the database and is backed by Call's
 * `@@index([leadId, deletedAt])` + `@@index([startedAt])`. With no window this reads
 * "has ever been contacted"; the UI always sends the client's "today" lower bound.
 *
 * The lead's own `deletedAt` and role scope are NOT applied here — they come from
 * `buildLeadWhere`, which this is ANDed with. Keeping the two apart means the contact
 * predicate can never be mistaken for the lead's visibility rule.
 */
export function recentlyContactedWhere(
  filters: TodayLeadsFilters,
): Prisma.LeadWhereInput {
  const startedAt: Prisma.DateTimeFilter = {};
  if (filters.from) startedAt.gte = new Date(filters.from);
  if (filters.to) startedAt.lt = new Date(filters.to);

  return {
    calls: {
      some: {
        deletedAt: null,
        ...(filters.from || filters.to ? { startedAt } : {}),
      },
    },
  };
}

/**
 * The one scoped `where` the report's list, summary and export all compose.
 *
 * Role scope + soft-delete + source + agent come from the leads module's `buildLeadWhere`
 * — the exact, tested fragments the Leads list and export use — so the report can never
 * leak a lead outside the caller's scope (AC4) and never drifts from those filters. The
 * report adds only its own "recently contacted" predicate on top.
 */
export function buildTodayLeadsWhere(
  user: CurrentUser,
  filters: TodayLeadsFilters,
): Prisma.LeadWhereInput {
  return {
    AND: [
      buildLeadWhere(user, {
        source: filters.source,
        assignedAgent: filters.agent,
      }),
      recentlyContactedWhere(filters),
    ],
  };
}
