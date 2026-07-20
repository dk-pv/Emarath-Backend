import { Prisma } from '../generated/prisma/client';

/**
 * Escapes the characters LIKE treats as wildcards so a search term is matched
 * literally (LEAD-03.1 AC3).
 *
 * Prisma's `contains` parameterises the value — there is no injection risk — but
 * it does NOT escape `%` and `_`, so a user searching "50%" would otherwise get
 * "5", then anything. The backslash is escaped first, or it would double-escape
 * the escapes added after it. Prisma emits `LIKE ... ESCAPE '\'`, so `\` is the
 * escape character these map to.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * The rows matching a free-text search, as a query fragment (LEAD-03.1).
 *
 * Scope is exactly the backlog: Customer Name and Primary Phone, nothing else —
 * firstName and secondaryPhone are deliberately excluded until a Workpex
 * reference proves them. Both use `contains` (unanchored substring, AC3) and the
 * GIN trigram indexes make that fast at volume. Case-insensitivity applies to
 * the name; a phone is digits, so the mode is moot there but harmless.
 *
 * Returns `undefined` for an empty or whitespace-only term, so the caller adds
 * no condition and the scoped list is returned unchanged (AC5).
 */
export function leadSearchWhere(
  term: string | undefined,
): Prisma.LeadWhereInput | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;

  const needle = escapeLike(trimmed);

  return {
    OR: [
      { name: { contains: needle, mode: 'insensitive' } },
      { primaryPhone: { contains: needle } },
    ],
  };
}
