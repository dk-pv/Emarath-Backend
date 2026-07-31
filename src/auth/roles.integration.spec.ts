/* eslint-disable @typescript-eslint/unbound-method --
 * These specs pass controller methods to a Reflector purely to READ their @Roles()
 * metadata; the guard never invokes them, so the usual unbound-`this` hazard does not
 * apply. */
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';
import { LeadsBulkController } from '../leads/bulk/leads-bulk.controller';
import { LeadRowActionsController } from '../leads/row-actions/leads-row-actions.controller';

/**
 * Integration of the real @Roles() decorators + RolesGuard + a real Reflector against the
 * actual controller handlers: proves the reassign routes deny an agent (AC4) and admit a
 * manager, and — just as important for scope — that an undecorated sibling route stays
 * open, so only the backlog-confirmed reassignment is gated.
 */
type Handler = (...args: unknown[]) => unknown;

function contextFor(
  controllerClass: object,
  handler: Handler,
  user: CurrentUser,
): ExecutionContext {
  const request: { user?: CurrentUser } = { user };
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

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

describe('Reassignment role gate (AUTH-02.2, integration)', () => {
  const guard = new RolesGuard(new Reflector());

  it('403s a sales agent on POST /leads/bulk/reassign', () => {
    const context = contextFor(
      LeadsBulkController,
      LeadsBulkController.prototype.reassign,
      agent,
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('admits a manager on POST /leads/bulk/reassign', () => {
    const context = contextFor(
      LeadsBulkController,
      LeadsBulkController.prototype.reassign,
      manager,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('403s a sales agent on POST /leads/:id/reassign', () => {
    const context = contextFor(
      LeadRowActionsController,
      LeadRowActionsController.prototype.reassign,
      agent,
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('leaves an undecorated sibling (bulk delete) open to an agent — only reassign is gated', () => {
    const context = contextFor(
      LeadsBulkController,
      LeadsBulkController.prototype.delete,
      agent,
    );
    expect(guard.canActivate(context)).toBe(true);
  });
});
