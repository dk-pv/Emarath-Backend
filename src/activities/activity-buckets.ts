import { Prisma } from '../generated/prisma/client';

/** The worklist tabs (ACT-02.1). List order within a bucket is by due date. */
export const ACTIVITY_BUCKETS = [
  'overdue',
  'today',
  'tomorrow',
  'completed',
  'all',
] as const;

export type ActivityBucket = (typeof ACTIVITY_BUCKETS)[number];

/**
 * The day boundaries the client computes in its own timezone (ADR-0028 §3), the
 * same way the Leads Quick Filter presets send their instants — so "today" is the
 * user's day, not the server's.
 */
export interface DayBoundaries {
  todayStart: Date; // start of today
  todayEnd: Date; // start of tomorrow (= end of today)
  tomorrowEnd: Date; // start of the day after (= end of tomorrow)
}

/**
 * The predicate for one tab. Overdue/Today/Tomorrow are OPEN items
 * (`completedAt: null`) in their due window — a done item lives in Completed, not
 * the open-work tabs (no Workpex reference for the exact predicate; consistent
 * with the tabs' triage purpose and the video's open ◯ rows). Completed is
 * anything done; All adds no predicate (scope-only).
 */
export function activityBucketWhere(
  bucket: ActivityBucket,
  b: DayBoundaries,
): Prisma.ActivityWhereInput {
  switch (bucket) {
    case 'overdue':
      return { completedAt: null, dueAt: { lt: b.todayStart } };
    case 'today':
      return {
        completedAt: null,
        dueAt: { gte: b.todayStart, lt: b.todayEnd },
      };
    case 'tomorrow':
      return {
        completedAt: null,
        dueAt: { gte: b.todayEnd, lt: b.tomorrowEnd },
      };
    case 'completed':
      return { completedAt: { not: null } };
    case 'all':
      return {};
  }
}
