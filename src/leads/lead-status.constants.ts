/**
 * The lead status that means "lost" (RPT-02.7, approved definition B1 — Workpex parity).
 * Owned by the leads module so the capture rule (store/clear `lostReason` on status
 * change) and the Lost Leads report share one definition; the report re-exports it.
 */
export const LOST_STATUS = 'LOST';
