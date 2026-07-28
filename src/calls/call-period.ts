import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Caps the aggregation window so a wide range can't force an unbounded scan. */
export const MAX_RANGE_DAYS = 366;

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * The [start, end) window a Call read covers (CALL-03.1 / CALL-04.1). Absent
 * bounds default to the whole of Today (UTC); `to` is exclusive. Shared so the
 * summary KPIs and the leaderboard resolve the period identically. Rejects an
 * inverted or oversized window here — the one place all three read endpoints
 * turn `from`/`to` into a range.
 */
export function resolvePeriod(query: { from?: string; to?: string }): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  const start = query.from ? new Date(query.from) : startOfUtcDay(now);
  const end = query.to
    ? new Date(query.to)
    : new Date(start.getTime() + DAY_MS);
  if (end.getTime() < start.getTime()) {
    throw new BadRequestException('to must be on or after from');
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(
      `date range must not exceed ${MAX_RANGE_DAYS} days`,
    );
  }
  return { start, end };
}
