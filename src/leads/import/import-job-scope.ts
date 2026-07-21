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
  if (user.role === UserRole.SALES_AGENT) {
    return { ...visible, createdById: user.id };
  }
  return visible;
}
