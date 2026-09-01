import { Prisma } from '../generated/prisma/client';

/** A half-open [from, to) window of ISO instants; empty means "ever". */
export interface EngagementWindow {
  from?: string;
  to?: string;
}

/**
 * "Contacted": the lead has a non-deleted ANSWERED call started in the window. NO_ANSWER /
 * BUSY rows are attempts, not contact. With no window this reads "ever reached". One
 * definition for Today Leads, the ownership metrics and the Leads list "Activity" filter.
 */
export function answeredCallWhere(
  window: EngagementWindow = {},
): Prisma.LeadWhereInput {
  const startedAt: Prisma.DateTimeFilter = {};
  if (window.from) startedAt.gte = new Date(window.from);
  if (window.to) startedAt.lt = new Date(window.to);
  return {
    calls: {
      some: {
        deletedAt: null,
        outcome: 'ANSWERED',
        ...(window.from || window.to ? { startedAt } : {}),
      },
    },
  };
}

/**
 * "No activity": no non-deleted activity completed in the window AND no non-deleted call
 * (any outcome — an attempt is activity) started in it. With no window this reads "never
 * worked". One definition for No Activity Leads, the ownership metrics and the list filter.
 */
export function noEngagementWhere(
  window: EngagementWindow = {},
): Prisma.LeadWhereInput {
  const completedAt: Prisma.DateTimeNullableFilter = { not: null };
  const startedAt: Prisma.DateTimeFilter = {};
  if (window.from) {
    completedAt.gte = new Date(window.from);
    startedAt.gte = new Date(window.from);
  }
  if (window.to) {
    completedAt.lt = new Date(window.to);
    startedAt.lt = new Date(window.to);
  }
  return {
    activities: { none: { deletedAt: null, completedAt } },
    calls: { none: { deletedAt: null, startedAt } },
  };
}
