import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PaymentStatus, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { RolesGuard } from '../auth/roles.guard';
import { AccountsRecordsController } from './accounts-records.controller';
import {
  ACCOUNTS_CORRECTION_ROLES,
  ACCOUNTS_MOVE_ROLES,
  ACCOUNTS_READ_ROLES,
  accountsRecordScopeWhere,
  allowedPaymentActions,
} from './accounts-roles';
import { correctionTargets, PAYMENT_MOVES } from './accounts-status';

const user = (role: UserRole): CurrentUser => ({ id: 'u1', role, team: null });
const P = PaymentStatus;
const ALL_ROLES = Object.values(UserRole);
const ALL_STATUSES = Object.values(PaymentStatus);

/*
  The provisional matrix the owner approved on 2026-10-17, written out by hand: the table must
  equal it exactly. The client confirmed the statuses (§6) and that heads correct backwards (Q14),
  not which moves are forward — when it does, this and `PAYMENT_MOVES` change together.
*/
const PROVISIONAL_MOVES: Record<PaymentStatus, PaymentStatus[]> = {
  INITIAL: [
    P.PAYMENT_PENDING,
    P.PAYMENT_RECEIVED,
    P.PAYMENT_FAILED,
    P.PARTIALLY_PAID,
  ],
  PAYMENT_PENDING: [P.PAYMENT_RECEIVED, P.PAYMENT_FAILED, P.PARTIALLY_PAID],
  PARTIALLY_PAID: [P.PAYMENT_RECEIVED, P.PAYMENT_FAILED],
  PAYMENT_FAILED: [P.PAYMENT_PENDING, P.PAYMENT_RECEIVED, P.PARTIALLY_PAID],
  PAYMENT_RECEIVED: [],
};

describe('the provisional payment moves', () => {
  it('is exactly the approved table, no move more or less', () => {
    expect(
      Object.fromEntries(
        Object.entries(PAYMENT_MOVES).map(([from, to]) => [from, [...to]]),
      ),
    ).toEqual(PROVISIONAL_MOVES);
  });

  it('holds the five statuses of the specification, INITIAL first (§6)', () => {
    expect(ALL_STATUSES).toEqual([
      'INITIAL',
      'PAYMENT_PENDING',
      'PAYMENT_RECEIVED',
      'PAYMENT_FAILED',
      'PARTIALLY_PAID',
    ]);
  });

  it('never moves a record back to INITIAL, out of PAYMENT_RECEIVED, or to its own status', () => {
    for (const from of ALL_STATUSES) {
      expect(PAYMENT_MOVES[from]).not.toContain(P.INITIAL);
      expect(PAYMENT_MOVES[from]).not.toContain(from);
    }
    expect(PAYMENT_MOVES.PAYMENT_RECEIVED).toEqual([]);
    expect(PAYMENT_MOVES.PARTIALLY_PAID).not.toContain(P.PAYMENT_PENDING);
  });

  it('lets a correction reach every other status, backwards included (Q14)', () => {
    for (const from of ALL_STATUSES) {
      expect(correctionTargets(from).sort()).toEqual(
        ALL_STATUSES.filter((status) => status !== from).sort(),
      );
    }
  });
});

describe('the Accounts permission split', () => {
  it('lets the Accounts Executive and the admin read and move, and nobody else', () => {
    expect([...ACCOUNTS_READ_ROLES]).toEqual([
      UserRole.ACCOUNTS_EXECUTIVE,
      UserRole.SUPERADMIN,
    ]);
    expect([...ACCOUNTS_MOVE_ROLES]).toEqual([
      UserRole.ACCOUNTS_EXECUTIVE,
      UserRole.SUPERADMIN,
    ]);
  });

  // Provisional until the client names the Accounts head (Q14).
  it('leaves corrections with the Super Admin alone', () => {
    expect([...ACCOUNTS_CORRECTION_ROLES]).toEqual([UserRole.SUPERADMIN]);
  });
});

describe('accountsRecordScopeWhere', () => {
  it.each([UserRole.ACCOUNTS_EXECUTIVE, UserRole.SUPERADMIN])(
    'leaves %s unrestricted',
    (role) => {
      expect(accountsRecordScopeWhere(user(role))).toEqual({});
    },
  );

  it.each(
    ALL_ROLES.filter(
      (role) =>
        role !== UserRole.ACCOUNTS_EXECUTIVE && role !== UserRole.SUPERADMIN,
    ),
  )('matches nothing for %s', (role) => {
    expect(accountsRecordScopeWhere(user(role))).toEqual({ id: { in: [] } });
  });
});

describe('allowedPaymentActions', () => {
  it.each(ALL_STATUSES)(
    'offers the Executive the table’s moves from %s and no correction',
    (status) => {
      expect(
        allowedPaymentActions(status, UserRole.ACCOUNTS_EXECUTIVE),
      ).toEqual({ moves: PROVISIONAL_MOVES[status], canCorrect: false });
    },
  );

  it.each(ALL_STATUSES)(
    'offers the Super Admin the same moves from %s, and the correction',
    (status) => {
      expect(allowedPaymentActions(status, UserRole.SUPERADMIN)).toEqual({
        moves: PROVISIONAL_MOVES[status],
        canCorrect: true,
      });
    },
  );

  it('offers every other role nothing, from every status', () => {
    for (const role of ALL_ROLES.filter(
      (each) =>
        each !== UserRole.ACCOUNTS_EXECUTIVE && each !== UserRole.SUPERADMIN,
    )) {
      for (const status of ALL_STATUSES) {
        expect(allowedPaymentActions(status, role)).toEqual({
          moves: [],
          canCorrect: false,
        });
      }
    }
  });
});

/*
  The tables above only matter if they are what the routes enforce. Checked against the real
  controller metadata through the real RolesGuard, every route × every role.
*/
describe('the Accounts routes', () => {
  const guard = new RolesGuard(new Reflector());
  const admits = (handler: keyof AccountsRecordsController, role: UserRole) => {
    const request = { user: user(role) };
    const context = {
      getHandler: () => AccountsRecordsController.prototype[handler],
      getClass: () => AccountsRecordsController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    try {
      return guard.canActivate(context);
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  };

  const ROUTES: [keyof AccountsRecordsController, readonly UserRole[]][] = [
    ['list', ACCOUNTS_READ_ROLES],
    ['summary', ACCOUNTS_READ_ROLES],
    ['filterOptions', ACCOUNTS_READ_ROLES],
    ['get', ACCOUNTS_READ_ROLES],
    ['move', ACCOUNTS_MOVE_ROLES],
    ['correct', ACCOUNTS_CORRECTION_ROLES],
  ];

  it.each(ROUTES)('%s admits exactly its roles', (handler, roles) => {
    for (const role of ALL_ROLES) {
      expect([role, admits(handler, role)]).toEqual([
        role,
        roles.includes(role),
      ]);
    }
  });
});
