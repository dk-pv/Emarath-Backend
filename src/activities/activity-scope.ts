import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';

/**
 * The activities a user may see, as a query fragment (ACT-02.1, ADR-0028 §4).
 *
 * Mirrors `leadScopeWhere`: a sales agent sees only activities they are an
 * assignee of; every other role sees all (team-based narrowing is deferred, as
 * in leads). Soft-deleted rows are excluded here, so no caller can scope by role
 * yet resurrect a deleted activity by forgetting the predicate. The linked lead
 * is read only through this scoped path, so navigating to it can never leak a
 * lead outside the caller's scope (ACT-09.1 AC3).
 *
 * `includeDeleted` keeps the role scope but drops the not-deleted filter, so the
 * delete path (ACT-06.1) can find an already-deleted row it owns and stay
 * idempotent instead of 404ing on a second delete.
 */
export function activityScopeWhere(
  user: CurrentUser,
  options: { includeDeleted?: boolean } = {},
): Prisma.ActivityWhereInput {
  const visible: Prisma.ActivityWhereInput = options.includeDeleted
    ? {}
    : { deletedAt: null };

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
  }
}
