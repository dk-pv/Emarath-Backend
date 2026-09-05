import { Prisma } from '../generated/prisma/client';

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
    or.push({ email: { equals: email, mode: 'insensitive' } });
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
