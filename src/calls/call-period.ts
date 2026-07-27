const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * The [start, end) window a Call read covers (CALL-03.1 / CALL-04.1). Absent
 * bounds default to the whole of Today (UTC); `to` is exclusive. Shared so the
 * summary KPIs and the leaderboard resolve the period identically.
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
  return { start, end };
}
