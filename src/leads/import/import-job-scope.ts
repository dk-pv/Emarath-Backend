import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUser } from '../../auth/current-user';
import { isOperationalRole } from '../../auth/role-groups';
import { openPipelinesWhere } from '../../pipelines/pipeline-access';

/**
 * The import jobs a user may see, as a query fragment (mirrors `leadScopeWhere`).
 *
 * A sales agent sees only the imports they ran; every other role sees all of them.
 * Applied at the query level so history, polling and the error report can never
 * return a job the caller did not create — an agent must not learn about another
 * agent's import.
 *
 * As with leads, a job into a pipeline closed to the caller is out of scope (ADR-0093): its
 * error report holds the rejected rows' customer data. An agent's own imports stay theirs.
 */
export function importJobScopeWhere(
  user: CurrentUser,
): Prisma.ImportJobWhereInput {
  const visible: Prisma.ImportJobWhereInput = { deletedAt: null };

  // An agent sees only imports they ran.
  if (user.role === UserRole.SALES_AGENT) {
    return { ...visible, createdById: user.id };
  }

  // A manager sees imports run by any team member (AUTH-02.1, ADR-0030 §3/§8);
  // no team → own-only (§7).
  if (user.role === UserRole.SALES_MANAGER) {
    return user.team
      ? {
          ...visible,
          ...openPipelinesWhere(user),
          createdBy: { team: user.team },
        }
      : { ...visible, ...openPipelinesWhere(user), createdById: user.id };
  }

  // Operational roles hold no sales access (ADR-0084): no import matches.
  if (isOperationalRole(user.role)) {
    return { ...visible, id: { in: [] } };
  }

  // Admin, Customer Service and Marketing see all (ADR-0030 §2.2 default) — the last two
  // only in the pipelines open to them; the admin opens every pipeline.
  return user.role === UserRole.SUPERADMIN
    ? visible
    : { ...visible, ...openPipelinesWhere(user) };
}
