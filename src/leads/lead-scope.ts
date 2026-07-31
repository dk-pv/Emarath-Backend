import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';

/**
 * The rows a user is allowed to see, as a query fragment (LEAD-02.1 AC3).
 *
 * Returns a `where` clause rather than filtering a fetched list: the scope has
 * to be part of the query the database runs, or an agent could page past their
 * own leads and a total count would report rows they cannot open. Every read
 * path — list, search, filter, export, get-by-id — composes this.
 *
 * Excluding soft-deleted rows lives here too, so no caller can scope correctly
 * and still resurrect a deleted lead by forgetting the second predicate.
 */
export function leadScopeWhere(
  user: CurrentUser,
  archived = false,
): Prisma.LeadWhereInput {
  // The Archived quick filter (LEAD-04.1) flips this predicate to show only
  // soft-deleted leads. The deletedAt condition is still owned here — never
  // elsewhere — so no caller can scope by role yet forget the delete state.
  const visible: Prisma.LeadWhereInput = {
    deletedAt: archived ? { not: null } : null,
  };

  switch (user.role) {
    // A sales agent sees only what is assigned to them. This is the rule the
    // whole scoping abstraction exists for.
    case UserRole.SALES_AGENT:
      return {
        ...visible,
        assignments: { some: { userId: user.id } },
      };

    // A sales manager sees their team's leads (AUTH-02.1, ADR-0030 §3/§8): any
    // lead assigned to a user on the manager's team. A manager with no team falls
    // back to own-only (§7) — never matching on a null team, which would sweep in
    // every teamless user.
    case UserRole.SALES_MANAGER:
      return {
        ...visible,
        assignments: user.team
          ? { some: { user: { team: user.team } } }
          : { some: { userId: user.id } },
      };

    // Admin is organization-wide; Customer Service and Marketing remain org-wide
    // by the approved default (ADR-0030 §2.2 — a Product-Owner decision, left
    // unchanged here). Widening a scope later is safe; an invented one is not.
    case UserRole.SUPERADMIN:
    case UserRole.CUSTOMER_SERVICE_AGENT:
    case UserRole.MARKETING_ANALYST:
      return visible;
  }
}
