import { LogisticsStatus, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { leadScopeWhere } from '../leads/lead-scope';
import { SALES_MODULE_ROLES } from '../auth/role-groups';
import { LOGISTICS_TRANSITIONS, LogisticsAction } from './logistics-status';

/**
 * Who may do what to a Logistics order (client clarification of 2026-09-23, §"Logistics
 * permissions"). Enforced server-side with `@Roles()` on every route — the UI hiding a button
 * is not a permission (ADR-0084: RolesGuard admits an operational role only where it is named).
 *
 * The client named a "QC role" and a "Logistics Manager". The system has two logistics roles
 * (ADR-0084), so QC maps to **LOGISTICS_EXECUTIVE** and the shipment lifecycle to
 * **LOGISTICS_MANAGER**; that mapping is the one inference in this file and is recorded in
 * ADR-0085 for the client to confirm. SUPERADMIN keeps the existing administrative model.
 */

/**
 * The QC routes' gate: QC verify and QC reject, and nothing else — QC cannot dispatch, deliver
 * or cancel. The role is the provisional inference described above, so both actions are withheld
 * (`WITHHELD_ACTIONS`): the routes stay gated, but nothing offers them.
 */
export const QC_ROLES: readonly UserRole[] = [
  UserRole.LOGISTICS_EXECUTIVE,
  UserRole.SUPERADMIN,
];

/**
 * Dispatch, delivery, cancellation and RTO. The resubmit route is gated here too, provisionally:
 * who resubmits is the open half of CD-2, so RESUBMIT is **withheld** — never offered by
 * `allowedActions` and called by no UI until the client answers. (It sits with the order's
 * lifecycle role rather than with Sales, who hold no Logistics mutation at all.)
 */
export const SHIPMENT_ROLES: readonly UserRole[] = [
  UserRole.LOGISTICS_MANAGER,
  UserRole.SUPERADMIN,
];

/** Reading an order: the sales roles (their own leads only) plus both logistics roles. */
export const LOGISTICS_READ_ROLES: readonly UserRole[] = [
  ...SALES_MODULE_ROLES,
  UserRole.LOGISTICS_MANAGER,
  UserRole.LOGISTICS_EXECUTIVE,
];

/**
 * The roles each action's route admits. The controller's `@Roles()` reads this table, so a
 * route and the actions offered for it can never disagree about who may take them.
 */
export const ACTION_ROLES: Readonly<
  Record<LogisticsAction, readonly UserRole[]>
> = {
  QC_VERIFY: QC_ROLES,
  QC_REJECT: QC_ROLES,
  RESUBMIT: SHIPMENT_ROLES,
  DISPATCH: SHIPMENT_ROLES,
  DELIVER: SHIPMENT_ROLES,
  CANCEL: SHIPMENT_ROLES,
  RTO: SHIPMENT_ROLES,
};

/**
 * Actions whose endpoint still works, gated exactly as before, but which `allowedActions`
 * never offers, because who should take them is still with the client: which role performs QC
 * (the Executive mapping above is an inference awaiting confirmation), and who resubmits a
 * rejected order — together with whether that resubmit refreshes the order from the corrected
 * lead. Offering them would turn an unconfirmed guess into a button. When the client answers,
 * this list shrinks and `ACTION_ROLES` changes, here and nowhere else.
 */
export const WITHHELD_ACTIONS: readonly LogisticsAction[] = [
  'QC_VERIFY',
  'QC_REJECT',
  'RESUBMIT',
];

/**
 * What the caller may do to an order in `status` right now — advisory, for the UI to render,
 * never a permission: each route's `@Roles()` and the conditional update in the service stay
 * the authority, and this can only ever be a subset of what they accept.
 *
 * An action is offered when all three hold: the transition table allows it from this status,
 * the caller's role is one its route admits, and it is not withheld. Nothing else is consulted
 * and nothing is special-cased — SUPERADMIN gets what the tables give it, not a bypass.
 * Visibility needs no check of its own: an order reaches a caller only through their scope,
 * and every role an action admits already reads every order.
 */
export function allowedActions(
  status: LogisticsStatus,
  role: UserRole,
): LogisticsAction[] {
  return (Object.keys(LOGISTICS_TRANSITIONS) as LogisticsAction[]).filter(
    (action) =>
      !WITHHELD_ACTIONS.includes(action) &&
      LOGISTICS_TRANSITIONS[action].from.includes(status) &&
      ACTION_ROLES[action].includes(role),
  );
}

/**
 * The orders a caller may read, as a query fragment (CLAUDE.md §8 — scope belongs in the
 * query, never in the UI).
 *
 * Logistics works every order, so its two roles and the admin are unrestricted. A sales caller
 * sees an order only when its lead is one they can already see, which reuses `leadScopeWhere`
 * verbatim: a sales agent reads their own converted leads' orders and no one else's. Any other
 * role (Accounts today) matches nothing, so a route opened to it by mistake still returns none.
 */
export function logisticsOrderScopeWhere(
  user: CurrentUser,
): Prisma.LogisticsOrderWhereInput {
  switch (user.role) {
    case UserRole.SUPERADMIN:
    case UserRole.LOGISTICS_MANAGER:
    case UserRole.LOGISTICS_EXECUTIVE:
      return {};

    case UserRole.SALES_MANAGER:
    case UserRole.SALES_AGENT:
    case UserRole.CUSTOMER_SERVICE_AGENT:
    case UserRole.MARKETING_ANALYST:
      return { lead: leadScopeWhere(user) };

    case UserRole.ACCOUNTS_EXECUTIVE:
      return { id: { in: [] } };
  }
}
