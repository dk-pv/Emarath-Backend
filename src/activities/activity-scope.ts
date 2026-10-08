import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { leadScopeWhere } from '../leads/lead-scope';

/**
 * The activities a user may see, as a query fragment (ACT-02.1, ADR-0028 §4).
 *
 * Two conditions, both required:
 * - the role's activity rule — a sales agent sees activities they are an assignee
 *   of, a manager those assigned to their team, admin / CS / marketing all;
 * - the linked lead is inside the caller's own lead scope (ADR-0086). Every row
 *   carries its lead's list columns, so without this an assignee on a lead they
 *   cannot open — a reassigned lead, a colleague's lead — would read it through
 *   the worklist (CLAUDE.md §8). `leadScopeWhere` also holds the lead's
 *   soft-delete predicate, so an archived lead's follow-ups leave every list and
 *   count until it is unarchived.
 *
 * Soft-deleted activities are excluded here, so no caller can scope by role yet
 * resurrect a deleted activity by forgetting the predicate.
 *
 * `includeDeleted` keeps both conditions but drops the activity's not-deleted
 * filter, so the delete path (ACT-06.1) can find an already-deleted row it owns
 * and stay idempotent instead of 404ing on a second delete.
 */
export function activityScopeWhere(
  user: CurrentUser,
  options: { includeDeleted?: boolean } = {},
): Prisma.ActivityWhereInput {
  const visible: Prisma.ActivityWhereInput = {
    ...(options.includeDeleted ? {} : { deletedAt: null }),
    lead: leadScopeWhere(user),
  };

  switch (user.role) {
    case UserRole.SALES_AGENT:
      return { ...visible, assignees: { some: { userId: user.id } } };

    // A sales manager sees their team's activities (AUTH-02.1, ADR-0030 §3/§8):
    // any activity assigned to a same-team user. No team → own-only (§7).
    case UserRole.SALES_MANAGER:
      return {
        ...visible,
        assignees: user.team
          ? { some: { user: { team: user.team } } }
          : { some: { userId: user.id } },
      };

    // Admin org-wide; Customer Service and Marketing org-wide by default (§2.2).
    case UserRole.SUPERADMIN:
    case UserRole.CUSTOMER_SERVICE_AGENT:
    case UserRole.MARKETING_ANALYST:
      return visible;

    // Operational roles hold no sales access (ADR-0084): no activity matches.
    case UserRole.LOGISTICS_MANAGER:
    case UserRole.LOGISTICS_EXECUTIVE:
    case UserRole.ACCOUNTS_EXECUTIVE:
    case UserRole.QC:
      return { ...visible, id: { in: [] } };
  }
}
