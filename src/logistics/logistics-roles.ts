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

/**
 * Setting the requested delivery date until QC verifies the order (Phase 2D, ADR-0094): the
 * sales agent on their own leads' orders and the Sales Manager on their team's — the service
 * reads the order through `logisticsOrderScopeWhere`, so anyone else's is a 404. Customer
 * Service and Marketing keep read access only. Provisional default P1, pending open client
 * question D1.
 */
export const DELIVERY_DATE_ROLES: readonly UserRole[] = [
  UserRole.SALES_AGENT,
  UserRole.SALES_MANAGER,
  UserRole.SUPERADMIN,
];

/**
 * Correcting the delivery date once QC has verified the order (client, 2026-10-17: the Logistics
 * team needs a controlled way to correct it): both Logistics roles. QC verifies only (Q11) and is
 * not named; Data & MIS has no role, and how it gets this is undecided.
 */
export const DELIVERY_DATE_CORRECTION_ROLES: readonly UserRole[] = [
  UserRole.LOGISTICS_MANAGER,
  UserRole.LOGISTICS_EXECUTIVE,
  UserRole.SUPERADMIN,
];

/**
 * Reading an order: the sales roles (their own leads only), both Logistics roles, QC, and
 * Accounts — Delivered orders only (`logisticsOrderScopeWhere`), read-only: no action names it.
 */
export const LOGISTICS_READ_ROLES: readonly UserRole[] = [
  ...SALES_MODULE_ROLES,
  UserRole.LOGISTICS_MANAGER,
  UserRole.LOGISTICS_EXECUTIVE,
  UserRole.QC,
  UserRole.ACCOUNTS_EXECUTIVE,
];

/** Everything a caller can do to an order: the status moves, and the edits. */
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
    SET_DELIVERY_DATE: DELIVERY_DATE_ROLES,
    CORRECT_DELIVERY_DATE: DELIVERY_DATE_CORRECTION_ROLES,
  };

const isOrderEdit = (action: OrderAction): action is OrderEdit =>
  action in ORDER_EDIT_STATUSES;

/** The statuses an action may be taken from: a move's sources, or an edit's statuses. */
export function actionStatuses(
  action: OrderAction,
): readonly LogisticsStatus[] {
  return isOrderEdit(action)
    ? ORDER_EDIT_STATUSES[action]
    : LOGISTICS_TRANSITIONS[action].from;
}

/**
 * The actions that change an order on its lead's behalf, which a caller may view but not take
 * on a lead in a pipeline closed to them (ADR-0093 B2): the service answers them with a 403.
 */
const LEAD_CHANGE_ACTIONS: readonly OrderAction[] = ['SET_DELIVERY_DATE'];

/**
 * The moves an order may not make without a delivery date — every order must have one (client,
 * 2026-10-17): QC does not verify an undated order and Logistics does not dispatch one. While the
 * order has none they are not offered, and the service refuses them with a 409.
 */
export const DATE_REQUIRED_ACTIONS: readonly LogisticsAction[] = [
  'QC_VERIFY',
  'DISPATCH',
];

/**
 * What the caller may do to an order in `status` right now — advisory, for the UI to render,
 * never a permission: each route's `@Roles()` and the conditional update in the service stay
 * the authority, and this can only ever be a subset of what they accept.
 *
 * An action is offered when both hold: it may be taken from this status, and the caller's role
 * is one its route admits. Nothing else is special-cased — SUPERADMIN gets what the tables give
 * it, not a bypass. Visibility needs no check of its own: an order reaches a caller only through
 * their scope. The one thing a scope cannot say is that the order's lead sits in a pipeline
 * closed to the caller (`leadClosed`), which a sales agent can see but not change, so the date
 * action is not offered there. And an order without a delivery date (`dated` false) is not
 * offered the moves that need one (`DATE_REQUIRED_ACTIONS`).
 */
export function allowedActions(
  status: LogisticsStatus,
  role: UserRole,
  leadClosed = false,
  dated = true,
): OrderAction[] {
  return (Object.keys(ACTION_ROLES) as OrderAction[]).filter(
    (action) =>
      actionStatuses(action).includes(status) &&
      ACTION_ROLES[action].includes(role) &&
      !(leadClosed && LEAD_CHANGE_ACTIONS.includes(action)) &&
      !(
        !dated &&
        (DATE_REQUIRED_ACTIONS as readonly OrderAction[]).includes(action)
      ),
  );
}

/**
 * The orders a caller may read, as a query fragment (CLAUDE.md §8 — scope belongs in the
 * query, never in the UI).
 *
 * Logistics works every order, so its two roles, QC and the admin are unrestricted. A sales caller
 * sees an order only when its lead is one they can already see, which reuses `leadScopeWhere`
 * verbatim: a sales agent reads their own converted leads' orders and no one else's. Accounts
 * reads the Delivered orders only — the client's "display logistics status with Delivered data
 * only" — until its own payment pipeline exists. Any other role matches nothing, so a route
 * opened to it by mistake still returns none.
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
      return { status: LogisticsStatus.DELIVERED };
  }
}
