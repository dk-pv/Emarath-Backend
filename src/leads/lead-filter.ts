import { Prisma } from '../generated/prisma/client';

/**
 * Coerces a filter query param into a clean string array (LEAD-03.2).
 *
 * A repeated param (`?status=New&status=Hot`) arrives as an array, a single one
 * (`?status=New`) as a scalar, and a blank one (`?status=`) as an empty string.
 * All three collapse here: scalars are wrapped, non-strings and blanks dropped.
 * Returns `undefined` when nothing usable remains, so the DTO's `@IsOptional`
 * skips it and a clearing/empty filter reads as "no filter" (AC5).
 */
export function normalizeFilterValues(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const cleaned = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

export interface LeadFilters {
  source?: string[];
  status?: string[];
  assignedAgent?: string[];
}

/**
 * The active field-filter fragments (LEAD-03.2 AC1/AC2).
 *
 * One fragment per present filter. The service ANDs them with scope and search,
 * so all conditions apply together and no filter can widen another's reach — an
 * agent filtering by a colleague still sees only their own leads (AC3). Within a
 * single field the values are ORed via `IN`: choosing two sources means "either
 * source", which is how the Workpex multi-select filter behaves. Source and
 * Status match exactly (they come from a fixed dropdown, and `@@index([source,
 * deletedAt])` / `@@index([status, deletedAt])` back the lookup); Assigned Agent
 * matches through the assignment join, covered by `@@index([userId])`.
 */
export function leadFilterWhere(filters: LeadFilters): Prisma.LeadWhereInput[] {
  const conditions: Prisma.LeadWhereInput[] = [];

  if (filters.source?.length) {
    conditions.push({ source: { in: filters.source } });
  }
  if (filters.status?.length) {
    conditions.push({ status: { in: filters.status } });
  }
  if (filters.assignedAgent?.length) {
    conditions.push({
      assignments: { some: { userId: { in: filters.assignedAgent } } },
    });
  }

  return conditions;
}
