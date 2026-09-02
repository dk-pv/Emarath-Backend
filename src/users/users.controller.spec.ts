/* eslint-disable @typescript-eslint/unbound-method --
 * Controller methods are handed to a Reflector purely to READ their @Roles() metadata; the
 * guard never invokes them, so the unbound-`this` hazard does not apply. Mirrors
 * roles.integration.spec.ts. */
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import type { CurrentUser } from '../auth/current-user';
import { UserRole } from '../generated/prisma/client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

type Handler = (...args: unknown[]) => unknown;

function contextFor(handler: Handler, role: UserRole): ExecutionContext {
  const user: CurrentUser = { id: 'u', role, team: 'Sales' };
  const request: { user?: CurrentUser } = { user };
  return {
    getHandler: () => handler,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * The real @Roles() decorator + RolesGuard + Reflector against the actual handlers.
 *
 * The whole controller is SUPERADMIN — including the read. The roster is the full staff
 * directory (emails, phones, activity), so unlike the integration library it must not be
 * enumerable by an ordinary agent.
 */
describe('Team member administration role gate', () => {
  const guard = new RolesGuard(new Reflector());

  const HANDLERS: [string, Handler][] = [
    ['list', UsersController.prototype.list],
    ['detail', UsersController.prototype.detail],
    ['create', UsersController.prototype.create],
    ['setAvatar', UsersController.prototype.setAvatar],
    ['update', UsersController.prototype.update],
    ['setPassword', UsersController.prototype.setPassword],
    ['remove', UsersController.prototype.remove],
    ['roles', UsersController.prototype.roles],
    ['leadForms', UsersController.prototype.leadForms],
    ['permissionCatalog', UsersController.prototype.permissionCatalog],
  ];

  it.each(HANDLERS)('admits a superadmin on %s', (_name, handler) => {
    expect(guard.canActivate(contextFor(handler, UserRole.SUPERADMIN))).toBe(
      true,
    );
  });

  it.each(HANDLERS)('403s a sales manager on %s', (_name, handler) => {
    expect(() =>
      guard.canActivate(contextFor(handler, UserRole.SALES_MANAGER)),
    ).toThrow(ForbiddenException);
  });

  it.each(HANDLERS)('403s a sales agent on %s', (_name, handler) => {
    expect(() =>
      guard.canActivate(contextFor(handler, UserRole.SALES_AGENT)),
    ).toThrow(ForbiddenException);
  });
});

describe('UsersController', () => {
  function makeController() {
    const list = jest.fn();
    const roles = jest.fn();
    const create = jest.fn();
    const update = jest.fn();
    const setPassword = jest.fn();
    const remove = jest.fn();
    const permissionCatalog = jest.fn();
    const service = {
      list,
      roles,
      create,
      update,
      setPassword,
      remove,
      permissionCatalog,
    } as unknown as UsersService;
    return {
      controller: new UsersController(service),
      list,
      roles,
      create,
      update,
      setPassword,
      remove,
      permissionCatalog,
    };
  }

  it('passes the id and password through to the service', async () => {
    const { controller, setPassword } = makeController();
    setPassword.mockResolvedValue({ id: 'x' });

    await controller.setPassword('x', { password: 'BrandNewPass1' });

    expect(setPassword).toHaveBeenCalledWith('x', 'BrandNewPass1');
  });

  it('serves the named-role rows for the wizard dropdown', async () => {
    const { controller, roles } = makeController();
    roles.mockResolvedValue([
      { id: 'r1', name: 'Account Holder', baseRole: UserRole.SUPERADMIN },
    ]);

    await expect(controller.roles()).resolves.toHaveLength(1);
  });

  it('serves the permission catalogue with 13 reference modules', () => {
    const { controller, permissionCatalog } = makeController();
    permissionCatalog.mockReturnValue(
      Array.from({ length: 13 }, (_, i) => ({ module: String(i) })),
    );

    expect(controller.permissionCatalog()).toHaveLength(13);
  });
});
