import { Prisma } from '../generated/prisma/client';
import { escapeLike } from './lead-search';

/** What a new enquiry is matched on. Fixed, exactly as the reference's banner states. */
export interface DuplicateCandidate {
  primaryPhone: string;
  secondaryPhone?: string | null;
  email?: string | null;
}

/** Which field caused a match, newest rule first. */
export type DuplicateMatchField = 'primaryPhone' | 'secondaryPhone' | 'email';

/**
 * The `where` that finds leads duplicating this enquiry.
 *
 * The matching rule is not configurable (the reference says so in as many words): an
 * enquiry duplicates an existing lead when either of its phone numbers matches either of
 * that lead's phone numbers, or its email matches that lead's email. Phones are compared
 * as stored; email case-insensitively, since an address is not case-sensitive in practice.
 *
 * `includeArchived` is the one configurable input — the "Check archived leads for
 * duplicates?" toggle. Off, soft-deleted leads are excluded, which is what every other
 * lead query does (CLAUDE.md §11: soft delete has no automatic filter).
 *
 * Returns `null` when the enquiry carries nothing to match on, so the caller can skip the
 * query entirely rather than issuing one that matches everything.
 */
export function duplicateWhere(
  candidate: DuplicateCandidate,
  includeArchived: boolean,
): Prisma.LeadWhereInput | null {
  const phones = [candidate.primaryPhone, candidate.secondaryPhone]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const email = candidate.email?.trim();

  const or: Prisma.LeadWhereInput[] = [];
  if (phones.length > 0) {
    or.push(
      { primaryPhone: { in: phones } },
      { secondaryPhone: { in: phones } },
    );
  }
  if (email) {
    // Prisma runs an insensitive `equals` as ILIKE, where `%` and `_` (legal in an address) are
    // wildcards: escaped, the address matches only itself, ignoring case.
    or.push({ email: { equals: escapeLike(email), mode: 'insensitive' } });
  }
  if (or.length === 0) return null;

  return {
    OR: or,
    ...(includeArchived ? {} : { deletedAt: null }),
  };
}

/**
 * Names the field that matched, for the warning the rep sees.
 *
 * Primary phone first, then secondary, then email — the order the reference's banner
 * lists them, so the reason given is the strongest one available rather than whichever
 * the database happened to compare first.
 */
export function matchedField(
  candidate: DuplicateCandidate,
  lead: {
    primaryPhone: string;
    secondaryPhone: string | null;
    email: string | null;
  },
): DuplicateMatchField {
  const phones = [candidate.primaryPhone, candidate.secondaryPhone]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  if (phones.includes(lead.primaryPhone)) return 'primaryPhone';
  if (lead.secondaryPhone && phones.includes(lead.secondaryPhone)) {
    return 'secondaryPhone';
  }
  return 'email';
}

/** A lead the duplicate rule matched, as far as choosing the original needs to know. */
export interface DuplicateMatchCandidate {
  id: string;
  createdAt: Date;
  /** Set when the candidate is itself recorded as a duplicate of an earlier lead. */
  duplicateOfId: string | null;
}

/**
 * Which matched lead a new duplicate is recorded against (ADR-0092): the OLDEST match that is
 * not itself a duplicate, falling back to the oldest match overall.
 *
 * Preferring a lead that is not already a duplicate keeps one customer's leads in a star —
 * every duplicate points at the same original — instead of a chain where the third lead
 * points at the second and the second at the first. Leads created in one import batch share a
 * creation time, so the id breaks the tie and the choice never depends on read order.
 *
 * Returns `null` when nothing matched.
 */
export function pickOriginal(
  matches: readonly DuplicateMatchCandidate[],
): string | null {
  const ranked = [...matches].sort(
    (a, b) =>
      Number(a.duplicateOfId !== null) - Number(b.duplicateOfId !== null) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  return ranked[0]?.id ?? null;
}
