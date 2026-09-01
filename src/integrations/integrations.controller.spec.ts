/* eslint-disable @typescript-eslint/unbound-method --
 * Controller methods are handed to a Reflector purely to READ their @Roles() metadata;
 * the guard never invokes them, so the unbound-`this` hazard does not apply. This
 * mirrors roles.integration.spec.ts. */
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import type { CurrentUser } from '../auth/current-user';
import { UserRole } from '../generated/prisma/client';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

type Handler = (...args: unknown[]) => unknown;

function contextFor(handler: Handler, role: UserRole): ExecutionContext {
  const user: CurrentUser = { id: 'u', role, team: 'Sales' };
  const request: { user?: CurrentUser } = { user };
  return {
    getHandler: () => handler,
    getClass: () => IntegrationsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * The real @Roles() decorators + RolesGuard + Reflector against the actual handlers
 * (INT-02.2 AC5, ADR-0054 §6): enablement is SUPERADMIN-only, and — just as important
 * for scope — reading the library stays open to every authenticated role, or the page
 * would 403 for the users it exists to serve.
 */
describe('Integration registry role gate (INT-02.2 AC5)', () => {
  const guard = new RolesGuard(new Reflector());

  it('admits a superadmin on PATCH /integrations/:id', () => {
    const context = contextFor(
      IntegrationsController.prototype.update,
      UserRole.SUPERADMIN,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([
    UserRole.SALES_MANAGER,
    UserRole.SALES_AGENT,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])('403s %s on PATCH /integrations/:id', (role) => {
    const context = contextFor(IntegrationsController.prototype.update, role);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it.each([
    UserRole.SUPERADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_AGENT,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])(
    'admits %s on GET /integrations — the library renders for everyone',
    (role) => {
      const context = contextFor(IntegrationsController.prototype.list, role);
      expect(guard.canActivate(context)).toBe(true);
    },
  );
});

describe('IntegrationsController', () => {
  function makeController() {
    const list = jest.fn();
    const setEnabled = jest.fn();
    const service = { list, setEnabled } as unknown as IntegrationsService;
    return {
      controller: new IntegrationsController(service),
      list,
      setEnabled,
    };
  }

  it('delegates the listing to the service', async () => {
    const { controller, list } = makeController();
    list.mockResolvedValue([]);

    await expect(controller.list()).resolves.toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('passes the id and the enabled flag through to the service', async () => {
    const { controller, setEnabled } = makeController();
    const id = '11111111-1111-1111-1111-111111111111';
    setEnabled.mockResolvedValue({ id, enabled: true });

    await controller.update(id, { enabled: true });

    expect(setEnabled).toHaveBeenCalledWith(id, true);
  });
});
