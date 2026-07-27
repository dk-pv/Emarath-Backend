import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { leadScopeWhere } from '../leads/lead-scope';

/**
 * The calls a user is allowed to see, as a query fragment. A call is visible
 * when its linked lead is in the caller's lead scope, so role scoping is
 * enforced at the query level (CLAUDE §8) — a sales agent's KPIs, leaderboard
 * and log only ever count calls on the leads assigned to them. Excludes
 * soft-deleted calls here so no read path forgets the predicate.
 *
 * This is the surfacing scope (CALL-02.2 AC5). Ingestion matching is
 * deliberately unscoped and does not use this.
 */
export function callScopeWhere(user: CurrentUser): Prisma.CallWhereInput {
  return { deletedAt: null, lead: leadScopeWhere(user) };
}
