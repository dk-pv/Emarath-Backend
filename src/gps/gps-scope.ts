import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';

/**
 * Which agents' GPS records (check-ins, tracking points) the caller may see, as a `User`
 * relation filter applied via `{ agent: gpsAgentWhere(user, filterUserId) }` (AUTH-02.1,
 * ADR-0030 §6). `undefined` means unrestricted (admin and the org-wide roles).
 *
 * Replaces the former inline `agentIdScope` scalar so GPS scopes the same way as the other
 * modules and gains manager team-scoping. The optional `filterUserId` (the dashboard's Team
 * Member narrowing) is **intersected** with the caller's scope, never allowed to widen it: an
 * agent is always pinned to self, and a manager passing a non-team userId matches no agent
 * (§6.2) instead of reaching an out-of-team agent's location. A manager with no team falls
 * back to own-only (§7).
 */
export function gpsAgentWhere(
  user: CurrentUser,
  filterUserId?: string,
): Prisma.UserWhereInput | undefined {
  switch (user.role) {
    case UserRole.SALES_AGENT:
      return { id: user.id };

    case UserRole.SALES_MANAGER:
      if (!user.team) {
        return { id: user.id };
      }
      return filterUserId
        ? { id: filterUserId, team: user.team }
        : { team: user.team };

    case UserRole.SUPERADMIN:
    case UserRole.CUSTOMER_SERVICE_AGENT:
    case UserRole.MARKETING_ANALYST:
      return filterUserId ? { id: filterUserId } : undefined;
  }
}
