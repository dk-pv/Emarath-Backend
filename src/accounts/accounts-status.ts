import { PaymentStatus } from '../generated/prisma/client';

/**
 * The Accounts pipeline's moves (ADR-0096).
 *
 * PROVISIONAL, pending client confirmation. What the client has confirmed: the five statuses
 * (specification §6); a delivered order arrives at INITIAL (§4 step 11); the Accounts Executive
 * updates it as payment comes in (§4 step 12) and verifies payment (§3, Q16); and "Accounts heads
 * can move backward or correct a payment status", with the history kept (Q14). What it has not
 * said is which moves are forward and which are backward, or who the Accounts head is.
 *
 * Until it does, this is the owner-approved default (2026-10-17): the Executive may move a record
 * anywhere except back to INITIAL, out of PAYMENT_RECEIVED, or from PARTIALLY_PAID back to
 * PAYMENT_PENDING. Each of those, and any other change, is a correction (`correct`), which needs
 * a reason and is the Super Admin's alone until the client names the Accounts head. The client's
 * answer changes this table and `ACCOUNTS_CORRECTION_ROLES`, nothing else.
 *
 * A move to PAYMENT_RECEIVED is the verification Q16 asks for: only an Accounts action takes a
 * record there, and its event names who did it and when. PARTIALLY_PAID → PARTIALLY_PAID (a
 * further part payment) is not a move yet: recording amounts waits for the client's rules.
 */
export const PAYMENT_MOVES: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  INITIAL: [
    PaymentStatus.PAYMENT_PENDING,
    PaymentStatus.PAYMENT_RECEIVED,
    PaymentStatus.PAYMENT_FAILED,
    PaymentStatus.PARTIALLY_PAID,
  ],
  PAYMENT_PENDING: [
    PaymentStatus.PAYMENT_RECEIVED,
    PaymentStatus.PAYMENT_FAILED,
    PaymentStatus.PARTIALLY_PAID,
  ],
  PARTIALLY_PAID: [
    PaymentStatus.PAYMENT_RECEIVED,
    PaymentStatus.PAYMENT_FAILED,
  ],
  PAYMENT_FAILED: [
    PaymentStatus.PAYMENT_PENDING,
    PaymentStatus.PAYMENT_RECEIVED,
    PaymentStatus.PARTIALLY_PAID,
  ],
  PAYMENT_RECEIVED: [],
};

/** A correction may take a record from any status to any other (Q14) — never to the same one. */
export function correctionTargets(from: PaymentStatus): PaymentStatus[] {
  return Object.values(PaymentStatus).filter((status) => status !== from);
}
