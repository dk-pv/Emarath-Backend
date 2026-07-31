import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';

function makeGuard(roles: UserRole[] | undefined) {
  const getAllAndOverride = jest.fn().mockReturnValue(roles);
  const reflector = { getAllAndOverride } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function ctx(user?: CurrentUser) {
  const request: { user?: CurrentUser } = { user };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return context;
}

const admin: CurrentUser = { id: 's', role: UserRole.SUPERADMIN, team: null };
const manager: CurrentUser = {
  id: 'm',
  role: UserRole.SALES_MANAGER,
  team: 'Sales',
};
const agent: CurrentUser = {
  id: 'a',
  role: UserRole.SALES_AGENT,
  team: 'Sales',
};

const REASSIGN_ROLES = [UserRole.SUPERADMIN, UserRole.SALES_MANAGER];

describe('RolesGuard (AUTH-02.2)', () => {
  it('allows a route with no @Roles() metadata (default-open)', () => {
    expect(makeGuard(undefined).canActivate(ctx(agent))).toBe(true);
  });

  it('allows a route with an empty role list', () => {
    expect(makeGuard([]).canActivate(ctx(agent))).toBe(true);
  });

  it('admits a listed manager to a restricted route', () => {
    expect(makeGuard(REASSIGN_ROLES).canActivate(ctx(manager))).toBe(true);
  });

  it('admits an admin to a restricted route', () => {
    expect(makeGuard(REASSIGN_ROLES).canActivate(ctx(admin))).toBe(true);
  });

  it('403s a non-listed role — the server block behind a hidden action (AC4)', () => {
    expect(() => makeGuard(REASSIGN_ROLES).canActivate(ctx(agent))).toThrow(
      ForbiddenException,
    );
  });

  it('403s when no authenticated user is present on a restricted route', () => {
    expect(() => makeGuard(REASSIGN_ROLES).canActivate(ctx(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
