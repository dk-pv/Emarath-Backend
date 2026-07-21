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

    // Everyone else reads the full lead set today. Team-based narrowing for
    // managers is deliberately absent: AUTH-01.1 defines team as scoping used
    // "later", and inventing a policy now would be a guess with security
    // consequences. Widening a scope later is safe; discovering an invented one
    // leaked data is not.
    case UserRole.SUPERADMIN:
    case UserRole.SALES_MANAGER:
    case UserRole.CUSTOMER_SERVICE_AGENT:
    case UserRole.MARKETING_ANALYST:
      return visible;
  }
}
