import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';

/**
 * The documents a user is allowed to see, as a query fragment (DOC-03.1 AC4).
 *
 * Returns a `where` clause, never a post-fetch filter: the scope must be part of
 * the query the database runs, or a caller could page past their own documents
 * and a total count would report rows they cannot open. Every read path (list,
 * count, sort, page, and any future get-by-id) composes this.
 *
 * The visibility rule is the DOC-01.1 access model — a document is visible to its
 * uploader (owner) or to any user named in its `DocumentAccess` whitelist —
 * with SUPERADMIN seeing the whole repository. This deliberately differs from
 * `leadScopeWhere`: documents carry explicit per-user grants, not team scoping (a
 * Document has no team link), so a manager sees only what they own or were
 * granted, and Customer Service / Marketing are NOT org-wide here (that would
 * bypass the whitelist). Owns the `deletedAt` predicate so no caller can scope by
 * access yet resurrect a soft-deleted row.
 */
export function documentScopeWhere(
  user: CurrentUser,
): Prisma.DocumentWhereInput {
  const visible: Prisma.DocumentWhereInput = { deletedAt: null };

  // Admin manages the whole repository; everyone else is owner-or-granted.
  if (user.role === UserRole.SUPERADMIN) return visible;

  return {
    ...visible,
    OR: [{ uploaderId: user.id }, { access: { some: { userId: user.id } } }],
  };
}
