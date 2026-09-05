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
 * When an open appointment turns overdue (Settings → Activity and Reminders →
 * "Make Appointment as Overdue"). `END_OF_DAY` is the shipped rule — overdue once
 * its own day has ended. `CUSTOM_TIME_SPAN` moves the cutoff to `minutes` after
 * the due time, so an appointment missed this morning is overdue this afternoon.
 */
export interface OverdueRule {
  mode: 'END_OF_DAY' | 'CUSTOM_TIME_SPAN';
  /** Only read in `CUSTOM_TIME_SPAN`. */
  minutes: number;
  now: Date;
}

/**
 * The single instant every bucket is measured against. Omitting the rule yields
 * `todayStart` — byte-identical to the rule that shipped — so the Leads quick
 * filters, the Dashboard KPIs and the follow-up reports that share this predicate
 * keep the behaviour they had until they are given a rule of their own.
 */
export function overdueCutoff(b: DayBoundaries, rule?: OverdueRule): Date {
  if (!rule || rule.mode === 'END_OF_DAY') return b.todayStart;
  return new Date(rule.now.getTime() - rule.minutes * 60_000);
}

/**
 * The predicate for one tab. Overdue/Today/Tomorrow are OPEN items
 * (`completedAt: null`) in their due window — a done item lives in Completed, not
 * the open-work tabs (no Workpex reference for the exact predicate; consistent
 * with the tabs' triage purpose and the video's open ◯ rows). Completed is
 * anything done; All adds no predicate (scope-only).
 *
 * Overdue and Today share one cutoff so they cannot both claim the same row: under
 * a custom time span, Today starts at the cutoff rather than at midnight.
 */
export function activityBucketWhere(
  bucket: ActivityBucket,
  b: DayBoundaries,
  rule?: OverdueRule,
): Prisma.ActivityWhereInput {
  const cutoff = overdueCutoff(b, rule);

  switch (bucket) {
    case 'overdue':
      return { completedAt: null, dueAt: { lt: cutoff } };
    case 'today':
      return {
        completedAt: null,
        dueAt: {
          gte: cutoff > b.todayStart ? cutoff : b.todayStart,
          lt: b.todayEnd,
        },
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
