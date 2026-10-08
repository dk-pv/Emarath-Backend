import { LogisticsStatus, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { leadScopeWhere } from '../leads/lead-scope';
import { SALES_MODULE_ROLES } from '../auth/role-groups';
import {
  LOGISTICS_TRANSITIONS,
  LogisticsAction,
  ORDER_EDIT_STATUSES,
  OrderEdit,
} from './logistics-status';

/**
 * Who may do what to a Logistics order: the client clarification of 2026-10-01 (Q1, Q2, Q5,
 * Q9), which replaces the provisional mapping recorded in ADR-0085. Enforced server-side with
 * `@Roles()` on every route — the UI hiding a button is not a permission (ADR-0084: RolesGuard
 * admits an operational role only where it is named). SUPERADMIN keeps the existing
 * administrative model and is listed on every action.
 */

/**
 * QC verifies or rejects an order and takes no other action (Q1). Confirmed by the client
 * (Q11): QC is a dedicated role responsible only for verification. The Logistics Manager does
 * not QC.
 */
export const QC_ROLES: readonly UserRole[] = [UserRole.QC, UserRole.SUPERADMIN];

/** Dispatch, delivery and cancellation: both Logistics roles (Q1). */
export const SHIPMENT_ROLES: readonly UserRole[] = [
  UserRole.LOGISTICS_MANAGER,
  UserRole.LOGISTICS_EXECUTIVE,
  UserRole.SUPERADMIN,
];

/**
 * The Logistics Manager's own: editing a QC-verified order (Q5) and correcting an AWB after
 * dispatch (Q9). RTO stays here as it was: Q1 gives the Executive Dispatch, Delivery and
 * Cancel and says nothing about RTO, so the Executive is not given it — pending open client
 * question Q14. If the Executive gets it, `ACTION_ROLES.RTO` becomes `SHIPMENT_ROLES`.
 */
export const MANAGER_ROLES: readonly UserRole[] = [
  UserRole.LOGISTICS_MANAGER,
  UserRole.SUPERADMIN,
];

/**
 * Resubmitting a QC-rejected order once Sales has corrected the lead (Q1, Q2): the Sales
 * Manager, on the orders of leads in their own scope only — the service reads the order
 * through `logisticsOrderScopeWhere`, so a manager outside the team gets a 404. A sales agent
 * (BDE) corrects the lead but is not named as a resubmitter — open client question Q18; a yes
 * adds `UserRole.SALES_AGENT` here.
 */
export const RESUBMIT_ROLES: readonly UserRole[] = [
  UserRole.SALES_MANAGER,
  UserRole.SUPERADMIN,
];

/** Reading an order: the sales roles (their own leads only), both Logistics roles and QC. */
export const LOGISTICS_READ_ROLES: readonly UserRole[] = [
  ...SALES_MODULE_ROLES,
  UserRole.LOGISTICS_MANAGER,
  UserRole.LOGISTICS_EXECUTIVE,
  UserRole.QC,
];

/** Everything a caller can do to an order: the status moves, and the two edits. */
export type OrderAction = LogisticsAction | OrderEdit;

/**
 * The roles each action's route admits. The controller's `@Roles()` reads this table, so a
 * route and the actions offered for it can never disagree about who may take them.
 */
export const ACTION_ROLES: Readonly<Record<OrderAction, readonly UserRole[]>> =
  {
    QC_VERIFY: QC_ROLES,
    QC_REJECT: QC_ROLES,
    RESUBMIT: RESUBMIT_ROLES,
    DISPATCH: SHIPMENT_ROLES,
    DELIVER: SHIPMENT_ROLES,
    CANCEL: SHIPMENT_ROLES,
    RTO: MANAGER_ROLES,
    EDIT: MANAGER_ROLES,
    CORRECT_AWB: MANAGER_ROLES,
  };

/** The statuses an action may be taken from: a move's sources, or an edit's statuses. */
export function actionStatuses(
  action: OrderAction,
): readonly LogisticsStatus[] {
  return action === 'EDIT' || action === 'CORRECT_AWB'
    ? ORDER_EDIT_STATUSES[action]
    : LOGISTICS_TRANSITIONS[action].from;
}

/**
 * What the caller may do to an order in `status` right now — advisory, for the UI to render,
 * never a permission: each route's `@Roles()` and the conditional update in the service stay
 * the authority, and this can only ever be a subset of what they accept.
 *
 * An action is offered when both hold: it may be taken from this status, and the caller's role
 * is one its route admits. Nothing else is consulted and nothing is special-cased — SUPERADMIN
 * gets what the tables give it, not a bypass. Visibility needs no check of its own: an order
 * reaches a caller only through their scope.
 */
export function allowedActions(
  status: LogisticsStatus,
  role: UserRole,
): OrderAction[] {
  return (Object.keys(ACTION_ROLES) as OrderAction[]).filter(
    (action) =>
      actionStatuses(action).includes(status) &&
      ACTION_ROLES[action].includes(role),
  );
}

/**
 * The orders a caller may read, as a query fragment (CLAUDE.md §8 — scope belongs in the
 * query, never in the UI).
 *
 * Logistics works every order, so its two roles, QC and the admin are unrestricted. A sales caller
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
    case UserRole.QC:
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
