import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { openPipelinesWhere } from '../pipelines/pipeline-access';

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
 *
 * Pipeline access lives here as well (ADR-0093): a lead in a pipeline closed to the caller
 * (`CurrentUser.deniedPipelines`) is outside their scope, so every read built on this —
 * reports, exports, dashboard, follow-ups, calls, audit history, Logistics orders — drops it
 * with no code of its own.
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
    // whole scoping abstraction exists for. Assigned leads stay visible in every
    // pipeline, one closed to them included (ADR-0093 B2): the assignment is what
    // lets them see it, and it lets them see it only — changing such a lead still
    // needs the pipeline (`assertMayChangeLead`).
    case UserRole.SALES_AGENT:
      return {
        ...visible,
        assignments: { some: { userId: user.id } },
      };

    // A sales manager sees their team's leads (AUTH-02.1, ADR-0030 §3/§8): any
    // lead assigned to a user on the manager's team. A manager with no team falls
    // back to own-only (§7) — never matching on a null team, which would sweep in
    // every teamless user. Only in the pipelines open to them (ADR-0093 B3), and
    // a grant never adds the unassigned leads this rule leaves out (B8).
    case UserRole.SALES_MANAGER:
      return {
        ...visible,
        ...openPipelinesWhere(user),
        assignments: user.team
          ? { some: { user: { team: user.team } } }
          : { some: { userId: user.id } },
      };

    // Admin is organization-wide, in every pipeline (ADR-0093 B1).
    case UserRole.SUPERADMIN:
      return visible;

    // Customer Service and Marketing remain org-wide by the approved default
    // (ADR-0030 §2.2 — a Product-Owner decision, left unchanged here), within the
    // pipelines open to them (ADR-0093 B4). Widening a scope later is safe; an
    // invented one is not.
    case UserRole.CUSTOMER_SERVICE_AGENT:
    case UserRole.MARKETING_ANALYST:
      return { ...visible, ...openPipelinesWhere(user) };

    // The operational roles hold no sales access (ADR-0084): no lead matches. Their
    // Logistics and Accounts records will carry their own scope.
    case UserRole.LOGISTICS_MANAGER:
    case UserRole.LOGISTICS_EXECUTIVE:
    case UserRole.ACCOUNTS_EXECUTIVE:
    case UserRole.QC:
      return { ...visible, id: { in: [] } };
  }
}
