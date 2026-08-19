/**
 * Splits one requested page into its pinned and unpinned slices (ADR-0031).
 *
 * The list orders the caller's pinned leads first, then everyone else, then
 * paginates that combined order. Rather than sort by a per-user relation (which
 * Prisma cannot `orderBy`), the page is served as two ordered blocks — pinned
 * ids `in`, then `notIn` — and this pure function works out how much of a given
 * `skip`/`take` window falls in each block. `pinnedCount` is how many of the
 * caller's pinned leads match the active filter/scope.
 *
 * Pure and side-effect free so the arithmetic — the one part that is easy to get
 * subtly wrong across page boundaries — is unit-tested without a database.
 */
export interface PinnedPageSlice {
  pinnedSkip: number;
  pinnedTake: number;
  unpinnedSkip: number;
  unpinnedTake: number;
}

export function pinnedPageSlice(
  skip: number,
  take: number,
  pinnedCount: number,
): PinnedPageSlice {
  // The pinned block occupies positions [0, pinnedCount); the unpinned block
  // takes over at pinnedCount. A page can straddle the boundary.
  const pinnedSkip = Math.min(skip, pinnedCount);
  const pinnedTake = Math.max(0, Math.min(take, pinnedCount - skip));
  const unpinnedSkip = Math.max(0, skip - pinnedCount);
  const unpinnedTake = take - pinnedTake;
  return { pinnedSkip, pinnedTake, unpinnedSkip, unpinnedTake };
}
