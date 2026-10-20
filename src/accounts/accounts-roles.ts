import { PaymentStatus, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { PAYMENT_MOVES } from './accounts-status';

/**
 * Who may do what in the Accounts pipeline (ADR-0096). Enforced server-side with `@Roles()` on
 * every route (ADR-0084: RolesGuard admits an operational role only where it is named); the UI
 * hiding a button is not a permission. SUPERADMIN keeps the existing administrative model and is
 * listed on every action.
 */

/** Reading the records, their counts and filter choices: the Accounts Executive (§3). */
export const ACCOUNTS_READ_ROLES: readonly UserRole[] = [
  UserRole.ACCOUNTS_EXECUTIVE,
  UserRole.SUPERADMIN,
];

/** Moving a record along `PAYMENT_MOVES`: the Accounts Executive updates payment (§4 step 12). */
export const ACCOUNTS_MOVE_ROLES: readonly UserRole[] = [
  UserRole.ACCOUNTS_EXECUTIVE,
  UserRole.SUPERADMIN,
];

/**
 * Correcting a payment status, backwards included, with a reason (Q14: "Accounts heads can move
 * backward or correct a payment status"). PROVISIONAL: no Accounts head role exists and the client
 * has not said who it is, so only the Super Admin corrects for now (owner decision 2026-10-17).
 * Once the client answers, the role it names is added here.
 */
export const ACCOUNTS_CORRECTION_ROLES: readonly UserRole[] = [
  UserRole.SUPERADMIN,
];

/**
 * The records a caller may read, as a query fragment (CLAUDE.md §8 — scope belongs in the query).
 * Accounts and the admin read every record; any other role matches nothing, so a route opened to
 * it by mistake still returns none, and the journey shows it no Accounts event.
 */
export function accountsRecordScopeWhere(
  user: CurrentUser,
): Prisma.AccountsRecordWhereInput {
  return ACCOUNTS_READ_ROLES.includes(user.role) ? {} : { id: { in: [] } };
}

/**
 * What the caller may do to a record in `status` right now — advisory, for the UI to render; the
 * routes' `@Roles()` and the service's checks stay the authority. `moves` are the statuses the
 * status route accepts from here, and `canCorrect` whether the correction route admits the caller.
 */
export function allowedPaymentActions(
  status: PaymentStatus,
  role: UserRole,
): { moves: PaymentStatus[]; canCorrect: boolean } {
  return {
    moves: ACCOUNTS_MOVE_ROLES.includes(role) ? [...PAYMENT_MOVES[status]] : [],
    canCorrect: ACCOUNTS_CORRECTION_ROLES.includes(role),
  };
}
