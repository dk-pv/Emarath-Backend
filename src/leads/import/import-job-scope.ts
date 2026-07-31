import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUser } from '../../auth/current-user';

/**
 * The import jobs a user may see, as a query fragment (mirrors `leadScopeWhere`).
 *
 * A sales agent sees only the imports they ran; every other role sees all of them.
 * Applied at the query level so history, polling and the error report can never
 * return a job the caller did not create — an agent must not learn about another
 * agent's import.
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
      ? { ...visible, createdBy: { team: user.team } }
      : { ...visible, createdById: user.id };
  }

  // Admin, Customer Service and Marketing see all (ADR-0030 §2.2 default).
  return visible;
}
