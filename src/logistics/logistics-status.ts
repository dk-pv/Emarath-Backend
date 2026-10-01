import { LogisticsStatus } from '../generated/prisma/client';
import { AuditAction } from '../audit/audit-events';

/**
 * The Logistics state machine (ADR-0085 B12, settled by the client clarification of
 * 2026-09-23).
 *
 * One table, read by the service and by the tests, so a transition cannot exist in code
 * without appearing here. Every move is a conditional update — `WHERE id = ? AND status IN
 * (from)` — so a stale or illegal request updates no row and is answered with a 409 naming the
 * status the order is actually in; nothing else can put an order into a state this table does
 * not allow.
 *
 * What the client decided:
 * - CD-2: a rejected order is **not** replaced. It returns to INITIAL through `RESUBMIT` and is
 *   checked again, so one lead never has two orders.
 * - CD-3: cancellation is allowed only after dispatch. INITIAL and QC_VERIFIED cannot cancel.
 * - CD-4: RTO is a status of its own, reached only from DISPATCHED, and terminal for this phase.
 *
 * DELIVERED, CANCELLED and RTO have no outgoing transition: they are terminal.
 */
export type LogisticsAction =
  | 'QC_VERIFY'
  | 'QC_REJECT'
  | 'RESUBMIT'
  | 'DISPATCH'
  | 'DELIVER'
  | 'CANCEL'
  | 'RTO';

export interface LogisticsTransition {
  /** The statuses the action may be applied from; anything else is a 409. */
  from: LogisticsStatus[];
  to: LogisticsStatus;
  /** The audit action recorded on the order (ADR-0085 B14). */
  action: AuditAction;
}

export const LOGISTICS_TRANSITIONS: Record<
  LogisticsAction,
  LogisticsTransition
> = {
  QC_VERIFY: {
    from: [LogisticsStatus.INITIAL],
    to: LogisticsStatus.QC_VERIFIED,
    action: 'QC_VERIFIED',
  },
  QC_REJECT: {
    from: [LogisticsStatus.INITIAL],
    to: LogisticsStatus.QC_REJECTED,
    action: 'QC_REJECTED',
  },
  // CD-2's "the same order returns to the Lead pipeline": a controlled action, never an
  // arbitrary status edit, and the only way out of QC_REJECTED.
  RESUBMIT: {
    from: [LogisticsStatus.QC_REJECTED],
    to: LogisticsStatus.INITIAL,
    action: 'RESUBMITTED',
  },
  DISPATCH: {
    from: [LogisticsStatus.QC_VERIFIED],
    to: LogisticsStatus.DISPATCHED,
    action: 'DISPATCHED',
  },
  DELIVER: {
    from: [LogisticsStatus.DISPATCHED],
    to: LogisticsStatus.DELIVERED,
    action: 'DELIVERED',
  },
  CANCEL: {
    from: [LogisticsStatus.DISPATCHED],
    to: LogisticsStatus.CANCELLED,
    action: 'CANCELLED',
  },
  RTO: {
    from: [LogisticsStatus.DISPATCHED],
    to: LogisticsStatus.RTO,
    action: 'RTO',
  },
};

/** The statuses nothing can leave — every action's `from` list excludes them. */
export const TERMINAL_STATUSES: readonly LogisticsStatus[] = [
  LogisticsStatus.DELIVERED,
  LogisticsStatus.CANCELLED,
  LogisticsStatus.RTO,
];

/**
 * The lead stage a QC rejection puts the lead into (CD-1): the stage the client already uses.
 * Not a new stage, and the existing one is never renamed — `RESERVED_STAGE_NAMES` keeps both
 * this and `WON` from being renamed away under the workflow's feet.
 */
export const QC_REJECTED_LEAD_STATUS = 'QC NOT APPROVED';
