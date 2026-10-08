import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LogisticsStatus, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { RolesGuard } from '../auth/roles.guard';
import { LogisticsOrdersController } from './logistics-orders.controller';
import {
  ACTION_ROLES,
  LOGISTICS_READ_ROLES,
  MANAGER_ROLES,
  OrderAction,
  QC_ROLES,
  RESUBMIT_ROLES,
  SHIPMENT_ROLES,
  actionStatuses,
  allowedActions,
  logisticsOrderScopeWhere,
} from './logistics-roles';

const user = (role: UserRole): CurrentUser => ({ id: 'u1', role, team: null });

/**
 * The client's permission split (clarification of 2026-10-01), kept in one readable place.
 * The route matrix (`operational-roles.integration.spec.ts`) proves these lists are the ones
 * actually on the routes; this proves the lists say what the client asked for.
 */
describe('the Logistics permission split', () => {
  it('gives QC the checks and nothing else (Q1)', () => {
    expect([...QC_ROLES]).toEqual([UserRole.QC, UserRole.SUPERADMIN]);
    for (const roles of [SHIPMENT_ROLES, MANAGER_ROLES, RESUBMIT_ROLES]) {
      expect(roles).not.toContain(UserRole.QC);
    }
  });

  it('lets both Logistics roles dispatch, deliver and cancel (Q1)', () => {
    expect([...SHIPMENT_ROLES]).toEqual([
      UserRole.LOGISTICS_MANAGER,
      UserRole.LOGISTICS_EXECUTIVE,
      UserRole.SUPERADMIN,
    ]);
  });

  it('keeps RTO, the order edit and the AWB correction with the Logistics Manager (Q5, Q9)', () => {
    expect([...MANAGER_ROLES]).toEqual([
      UserRole.LOGISTICS_MANAGER,
      UserRole.SUPERADMIN,
    ]);
    expect(MANAGER_ROLES).not.toContain(UserRole.LOGISTICS_EXECUTIVE);
  });

  it('lets the Sales Manager resubmit, and no other sales role (Q1)', () => {
    expect([...RESUBMIT_ROLES]).toEqual([
      UserRole.SALES_MANAGER,
      UserRole.SUPERADMIN,
    ]);
  });

  it('lets Sales and QC read, and keeps Accounts out until its own phase', () => {
    expect(LOGISTICS_READ_ROLES).toContain(UserRole.SALES_AGENT);
    expect(LOGISTICS_READ_ROLES).toContain(UserRole.SALES_MANAGER);
    expect(LOGISTICS_READ_ROLES).toContain(UserRole.QC);
    expect(LOGISTICS_READ_ROLES).not.toContain(UserRole.ACCOUNTS_EXECUTIVE);
  });
});

describe('logisticsOrderScopeWhere', () => {
  it.each([
    UserRole.SUPERADMIN,
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.QC,
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
  });

  it('matches nothing for a role with no Logistics business', () => {
    expect(logisticsOrderScopeWhere(user(UserRole.ACCOUNTS_EXECUTIVE))).toEqual(
      { id: { in: [] } },
    );
  });
});

const ALL_STATUSES = Object.values(LogisticsStatus);
const ALL_ROLES = Object.values(UserRole);
const ALL_ACTIONS = Object.keys(ACTION_ROLES) as OrderAction[];

const S = LogisticsStatus;

/** What each role is offered, status by status. Anything not listed is offered nothing. */
const BY_ROLE: Partial<
  Record<UserRole, Partial<Record<LogisticsStatus, OrderAction[]>>>
> = {
  [UserRole.QC]: { [S.INITIAL]: ['QC_VERIFY', 'QC_REJECT'] },
  [UserRole.LOGISTICS_MANAGER]: {
    [S.QC_VERIFIED]: ['DISPATCH', 'EDIT'],
    [S.DISPATCHED]: ['DELIVER', 'CANCEL', 'RTO', 'CORRECT_AWB'],
    [S.DELIVERED]: ['CORRECT_AWB'],
    [S.CANCELLED]: ['CORRECT_AWB'],
    [S.RTO]: ['CANCEL', 'CORRECT_AWB'],
  },
  [UserRole.LOGISTICS_EXECUTIVE]: {
    [S.QC_VERIFIED]: ['DISPATCH'],
    [S.DISPATCHED]: ['DELIVER', 'CANCEL'],
    [S.RTO]: ['CANCEL'],
  },
  [UserRole.SALES_MANAGER]: { [S.QC_REJECTED]: ['RESUBMIT'] },
};

describe('allowedActions — by role and status', () => {
  it.each(
    ALL_ROLES.filter((role) => role !== UserRole.SUPERADMIN).flatMap((role) =>
      ALL_STATUSES.map((status): [UserRole, LogisticsStatus] => [role, status]),
    ),
  )('%s on a %s order', (role, status) => {
    expect(allowedActions(status, role)).toEqual(BY_ROLE[role]?.[status] ?? []);
  });

  it('gives SUPERADMIN every action the tables allow from each status — no bypass of its own', () => {
    for (const status of ALL_STATUSES) {
      expect(allowedActions(status, UserRole.SUPERADMIN)).toEqual(
        ALL_ACTIONS.filter((action) => actionStatuses(action).includes(status)),
      );
    }
  });
});

describe('allowedActions — never offers what the confirmed rules forbid', () => {
  const offeredAnywhere = (action: OrderAction, status: LogisticsStatus) =>
    ALL_ROLES.some((role) => allowedActions(status, role).includes(action));
  const except = (...kept: LogisticsStatus[]) =>
    ALL_STATUSES.filter((status) => !kept.includes(status));

  it.each(except(S.DISPATCHED))(
    'offers no one DELIVER or RTO from %s',
    (status) => {
      expect(offeredAnywhere('DELIVER', status)).toBe(false);
      expect(offeredAnywhere('RTO', status)).toBe(false);
    },
  );

  // CD-3: no cancel before dispatch. Q6: an RTO order is closed by cancelling it.
  it.each(except(S.DISPATCHED, S.RTO))(
    'offers no one CANCEL from %s',
    (status) => {
      expect(offeredAnywhere('CANCEL', status)).toBe(false);
    },
  );

  it.each(except(S.QC_VERIFIED))(
    'offers no one DISPATCH or the order edit from %s',
    (status) => {
      expect(offeredAnywhere('DISPATCH', status)).toBe(false);
      expect(offeredAnywhere('EDIT', status)).toBe(false);
    },
  );

  it.each([S.INITIAL, S.QC_VERIFIED, S.QC_REJECTED])(
    'offers no one an AWB correction before dispatch (%s)',
    (status) => {
      expect(offeredAnywhere('CORRECT_AWB', status)).toBe(false);
    },
  );

  // Q8: once cancelled, no further status. Delivered stays terminal too.
  it.each([S.CANCELLED, S.DELIVERED])(
    'offers no one a status move from %s',
    (status) => {
      const moves = ALL_ROLES.flatMap((role) =>
        allowedActions(status, role),
      ).filter((action) => action !== 'CORRECT_AWB');
      expect(moves).toEqual([]);
    },
  );
});

/*
  The list is advisory, so the one thing it must never do is offer an action the endpoint would
  refuse. This checks it against the real controller metadata through the real RolesGuard —
  not against the table it was built from — so an edit to either side that breaks the pairing
  fails here.
*/
describe('allowedActions — agrees with the routes that enforce them', () => {
  const guard = new RolesGuard(new Reflector());
  const HANDLER: Record<OrderAction, keyof LogisticsOrdersController> = {
    QC_VERIFY: 'qcVerify',
    QC_REJECT: 'qcReject',
    RESUBMIT: 'resubmit',
    DISPATCH: 'dispatch',
    DELIVER: 'deliver',
    CANCEL: 'cancel',
    RTO: 'rto',
    EDIT: 'edit',
    CORRECT_AWB: 'correctAwb',
  };

  function routeAdmits(action: OrderAction, role: UserRole): boolean {
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

  it('offers an action exactly where its route admits the role and the status allows it', () => {
    let offered = 0;
    for (const role of ALL_ROLES) {
      for (const status of ALL_STATUSES) {
        const actions = allowedActions(status, role);
        for (const action of ALL_ACTIONS) {
          const expected =
            routeAdmits(action, role) &&
            actionStatuses(action).includes(status);
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
    // Not vacuous: QC 2×1 each for verify and reject, resubmit 2, dispatch 3, deliver 3,
    // cancel 3 roles × 2 statuses, RTO 2, edit 2, AWB correction 2 roles × 4 statuses.
    expect(offered).toBe(30);
  });

  it('gates every route by the one table', () => {
    expect(ACTION_ROLES).toEqual({
      QC_VERIFY: QC_ROLES,
      QC_REJECT: QC_ROLES,
      RESUBMIT: RESUBMIT_ROLES,
      DISPATCH: SHIPMENT_ROLES,
      DELIVER: SHIPMENT_ROLES,
      CANCEL: SHIPMENT_ROLES,
      RTO: MANAGER_ROLES,
      EDIT: MANAGER_ROLES,
      CORRECT_AWB: MANAGER_ROLES,
    });
  });

  it.each([
    ['QC_VERIFY', UserRole.QC, true],
    ['DISPATCH', UserRole.QC, false],
    ['DELIVER', UserRole.QC, false],
    ['CANCEL', UserRole.QC, false],
    ['RTO', UserRole.QC, false],
    ['EDIT', UserRole.QC, false],
    ['DISPATCH', UserRole.LOGISTICS_EXECUTIVE, true],
    ['EDIT', UserRole.LOGISTICS_EXECUTIVE, false],
    ['CORRECT_AWB', UserRole.LOGISTICS_EXECUTIVE, false],
    ['RESUBMIT', UserRole.SALES_MANAGER, true],
    ['RESUBMIT', UserRole.SALES_AGENT, false],
    ['QC_VERIFY', UserRole.LOGISTICS_MANAGER, false],
  ] as const)('the %s route admits %s: %s', (action, role, admitted) => {
    expect(routeAdmits(action, role)).toBe(admitted);
  });
});
