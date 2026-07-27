/**
 * Call Connect % (CALL-07.1) — the one computation the summary KPIs and the
 * leaderboard both use, so the definition never drifts (AC3).
 *
 * Approved Option A: **Answered ÷ Total × 100**, per the Workpex video — NOT the
 * backlog AC1 "unique contacts reached" formula, which the owner superseded
 * (Change Request C2). Rounded to two decimals to match the on-screen value
 * (e.g. 9 ÷ 16 = 56.25). Zero calls returns 0, never a division error (AC4).
 */
export function callConnectPct(answered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((answered / total) * 10000) / 100;
}
