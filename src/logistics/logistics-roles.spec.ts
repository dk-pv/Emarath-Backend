import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LogisticsStatus, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { RolesGuard } from '../auth/roles.guard';
import { LogisticsOrdersController } from './logistics-orders.controller';
import { LOGISTICS_TRANSITIONS, LogisticsAction } from './logistics-status';
import {
  ACTION_ROLES,
  LOGISTICS_READ_ROLES,
  QC_ROLES,
  SHIPMENT_ROLES,
  WITHHELD_ACTIONS,
  allowedActions,
  logisticsOrderScopeWhere,
} from './logistics-roles';

const user = (role: UserRole): CurrentUser => ({ id: 'u1', role, team: null });

/**
 * The client's permission split, kept in one readable place. The route matrix
 * (`operational-roles.integration.spec.ts`) proves these lists are the ones actually on the
 * routes; this proves the lists say what the client asked for.
 */
describe('the Logistics permission split', () => {
  it('gives QC the checks and nothing else', () => {
    expect([...QC_ROLES]).toEqual([
      UserRole.LOGISTICS_EXECUTIVE,
      UserRole.SUPERADMIN,
    ]);
    expect(QC_ROLES).not.toContain(UserRole.LOGISTICS_MANAGER);
    expect(QC_ROLES).not.toContain(UserRole.SALES_AGENT);
  });

  it('gives the Logistics Manager the shipment lifecycle and no QC decision', () => {
    expect([...SHIPMENT_ROLES]).toEqual([
      UserRole.LOGISTICS_MANAGER,
      UserRole.SUPERADMIN,
    ]);
    expect(SHIPMENT_ROLES).not.toContain(UserRole.LOGISTICS_EXECUTIVE);
  });

  it('lets Sales read, and keeps Accounts out until its own phase', () => {
    expect(LOGISTICS_READ_ROLES).toContain(UserRole.SALES_AGENT);
    expect(LOGISTICS_READ_ROLES).toContain(UserRole.SALES_MANAGER);
    expect(LOGISTICS_READ_ROLES).not.toContain(UserRole.ACCOUNTS_EXECUTIVE);
  });
});

describe('logisticsOrderScopeWhere', () => {
  it.each([
    UserRole.SUPERADMIN,
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
  ])('leaves %s unrestricted — Logistics works every order', (role) => {
    expect(logisticsOrderScopeWhere(user(role))).toEqual({});
  });

  it('limits a sales agent to the orders of leads they can already see', () => {
    const where = logisticsOrderScopeWhere(user(UserRole.SALES_AGENT));
    expect(where).toEqual({
      lead: { deletedAt: null, assignments: { some: { userId: 'u1' } } },
    });
  });

  it('limits a sales manager to their team’s leads', () => {
    const where = logisticsOrderScopeWhere({
      id: 'u1',
      role: UserRole.SALES_MANAGER,
      team: 'Dubai',
    });
    expect(JSON.stringify(where)).toContain('"team":"Dubai"');
  });

  /*
    Pinned as it stands: the sales branch carries the lead scope, and that excludes archived
    leads — so archiving a converted lead takes its order out of the sales view while Logistics
    keeps working it. Whether Sales should keep seeing it is still with the client.
  */
  it('hides an archived lead’s order from Sales but not from Logistics', () => {
    const sales = logisticsOrderScopeWhere(user(UserRole.SALES_AGENT));

    expect(JSON.stringify(sales)).toContain('"deletedAt":null');
    expect(logisticsOrderScopeWhere(user(UserRole.LOGISTICS_MANAGER))).toEqual(
      {},
    );
    expect(
      logisticsOrderScopeWhere(user(UserRole.LOGISTICS_EXECUTIVE)),
    ).toEqual({});
  });

  it('matches nothing for a role with no Logistics business', () => {
    expect(logisticsOrderScopeWhere(user(UserRole.ACCOUNTS_EXECUTIVE))).toEqual(
      { id: { in: [] } },
    );
  });
});

const ALL_STATUSES = Object.values(LogisticsStatus);
const ALL_ROLES = Object.values(UserRole);
const ALL_ACTIONS = Object.keys(LOGISTICS_TRANSITIONS) as LogisticsAction[];

/*
  The client-confirmed shipment lifecycle, per status, for a role that holds every confirmed
  permission. The QC and resubmit steps are empty on purpose: those actions are withheld until
  the client says who takes them (WITHHELD_ACTIONS).
*/
const BY_STATUS: [LogisticsStatus, LogisticsAction[]][] = [
  [LogisticsStatus.INITIAL, []],
  [LogisticsStatus.QC_REJECTED, []],
  [LogisticsStatus.QC_VERIFIED, ['DISPATCH']],
  [LogisticsStatus.DISPATCHED, ['DELIVER', 'CANCEL', 'RTO']],
  [LogisticsStatus.DELIVERED, []],
  [LogisticsStatus.CANCELLED, []],
  [LogisticsStatus.RTO, []],
];

describe('allowedActions — by status', () => {
  it('has a row for every status, so a new one cannot slip in undecided', () => {
    expect(BY_STATUS.map(([status]) => status).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });

  it.each(BY_STATUS)(
    '%s offers the Logistics Manager %j',
    (status, expected) => {
      expect(allowedActions(status, UserRole.LOGISTICS_MANAGER)).toEqual(
        expected,
      );
    },
  );

  it('gives SUPERADMIN what the same tables give it — no bypass of its own', () => {
    for (const status of ALL_STATUSES) {
      expect(allowedActions(status, UserRole.SUPERADMIN)).toEqual(
        allowedActions(status, UserRole.LOGISTICS_MANAGER),
      );
    }
  });
});

describe('allowedActions — by role', () => {
  it.each([
    UserRole.SALES_MANAGER,
    UserRole.SALES_AGENT,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])('offers %s nothing: reading an order is not acting on it', (role) => {
    for (const status of ALL_STATUSES) {
      expect(allowedActions(status, role)).toEqual([]);
    }
  });

  // Its only routes are the QC checks, which are withheld until the client names the QC role.
  it('offers the Logistics Executive nothing while QC is withheld', () => {
    for (const status of ALL_STATUSES) {
      expect(allowedActions(status, UserRole.LOGISTICS_EXECUTIVE)).toEqual([]);
    }
  });

  it('offers Accounts nothing', () => {
    for (const status of ALL_STATUSES) {
      expect(allowedActions(status, UserRole.ACCOUNTS_EXECUTIVE)).toEqual([]);
    }
  });
});

describe('allowedActions — never offers what the confirmed rules forbid', () => {
  const offeredAnywhere = (action: LogisticsAction, status: LogisticsStatus) =>
    ALL_ROLES.some((role) => allowedActions(status, role).includes(action));
  const except = (...kept: LogisticsStatus[]) =>
    ALL_STATUSES.filter((status) => !kept.includes(status));

  it.each(except(LogisticsStatus.DISPATCHED))(
    'offers no one CANCEL, DELIVER or RTO from %s',
    (status) => {
      // CD-3: no cancel before dispatch. CD-4: RTO only from DISPATCHED — so never before
      // it, never again after RTO, and not from DELIVERED, which stays with the client.
      for (const action of ['CANCEL', 'DELIVER', 'RTO'] as const) {
        expect(offeredAnywhere(action, status)).toBe(false);
      }
    },
  );

  it.each(except(LogisticsStatus.QC_VERIFIED))(
    'offers no one DISPATCH from %s',
    (status) => {
      expect(offeredAnywhere('DISPATCH', status)).toBe(false);
    },
  );

  it('offers no one a QC decision or a resubmit, whatever the role or status', () => {
    for (const status of ALL_STATUSES) {
      for (const action of ['QC_VERIFY', 'QC_REJECT', 'RESUBMIT'] as const) {
        expect(offeredAnywhere(action, status)).toBe(false);
      }
    }
  });
});

/*
  The list is advisory, so the one thing it must never do is offer an action the endpoint would
  refuse. This checks it against the real controller metadata through the real RolesGuard —
  not against the table it was built from — so an edit to either side that breaks the pairing
  fails here.
*/
describe('allowedActions — agrees with the routes that enforce them', () => {
  const guard = new RolesGuard(new Reflector());
  const HANDLER: Record<LogisticsAction, keyof LogisticsOrdersController> = {
    QC_VERIFY: 'qcVerify',
    QC_REJECT: 'qcReject',
    RESUBMIT: 'resubmit',
    DISPATCH: 'dispatch',
    DELIVER: 'deliver',
    CANCEL: 'cancel',
    RTO: 'rto',
  };

  function routeAdmits(action: LogisticsAction, role: UserRole): boolean {
    const handler = LogisticsOrdersController.prototype[HANDLER[action]];
    const context = {
      getHandler: () => handler,
      getClass: () => LogisticsOrdersController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u', role, team: null } }),
      }),
    } as unknown as ExecutionContext;
    try {
      return guard.canActivate(context);
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  it('offers an action exactly where its route admits the role and the table allows the move — bar the withheld', () => {
    let offered = 0;
    for (const role of ALL_ROLES) {
      for (const status of ALL_STATUSES) {
        const actions = allowedActions(status, role);
        for (const action of ALL_ACTIONS) {
          const possible =
            routeAdmits(action, role) &&
            LOGISTICS_TRANSITIONS[action].from.includes(status);
          const expected = possible && !WITHHELD_ACTIONS.includes(action);
          expect({
            role,
            status,
            action,
            offered: actions.includes(action),
          }).toEqual({ role, status, action, offered: expected });
          if (expected) offered++;
        }
      }
    }
    // The check above is not vacuous: the Manager and the admin each get DISPATCH once and
    // DELIVER, CANCEL and RTO once — eight offers across the whole matrix.
    expect(offered).toBe(8);
  });

  it('withholds exactly the actions whose taker the client has not confirmed', () => {
    expect([...WITHHELD_ACTIONS].sort()).toEqual([
      'QC_REJECT',
      'QC_VERIFY',
      'RESUBMIT',
    ]);
  });

  it('leaves the withheld routes gated exactly as before — withheld is not refused', () => {
    expect(ACTION_ROLES).toEqual({
      QC_VERIFY: QC_ROLES,
      QC_REJECT: QC_ROLES,
      RESUBMIT: SHIPMENT_ROLES,
      DISPATCH: SHIPMENT_ROLES,
      DELIVER: SHIPMENT_ROLES,
      CANCEL: SHIPMENT_ROLES,
      RTO: SHIPMENT_ROLES,
    });
    expect(routeAdmits('QC_VERIFY', UserRole.LOGISTICS_EXECUTIVE)).toBe(true);
    expect(routeAdmits('RESUBMIT', UserRole.LOGISTICS_MANAGER)).toBe(true);
  });
});
