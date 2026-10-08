import { readdirSync } from 'fs';
import { join } from 'path';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import type { ExecutionContext, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { OPERATIONAL_ROLES, SALES_MODULE_ROLES } from './role-groups';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';

/**
 * Every route the app serves, against the real @Roles()/@Public() metadata and the real
 * RolesGuard (ADR-0084). Discovered from the controller files rather than listed, so a
 * controller added later is covered without anyone remembering this spec.
 *
 * Proves the two halves of the operational-roles rule:
 *   1. a post-sale role (QC included) is refused on every non-public route except Documents
 *      and the Logistics/journey routes that name it;
 *   2. each sales role reaches exactly the routes it reached before those roles existed,
 *      against a hand-written table, so no existing access moved.
 */
type Route = {
  label: string;
  controller: string;
  handler: (...args: unknown[]) => unknown;
  controllerClass: Type<unknown>;
};

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'generated' ? [] : controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

function discoverRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exports = require(file) as Record<string, unknown>;
    for (const value of Object.values(exports)) {
      if (typeof value !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, value) as
        string | undefined;
      if (base === undefined) continue;
      const proto = (value as { prototype: Record<string, unknown> }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        routes.push({
          label: `${RequestMethod[method]} /api/${[base, path].filter((p) => p && p !== '/').join('/')}`,
          controller: value.name,
          handler: handler as Route['handler'],
          controllerClass: value as Type<unknown>,
        });
      }
    }
  }
  return routes;
}

const reflector = new Reflector();
const guard = new RolesGuard(reflector);
const ROUTES = discoverRoutes();

function isPublic(route: Route): boolean {
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      route.handler,
      route.controllerClass,
    ]) === true
  );
}

function admits(route: Route, role: UserRole): boolean {
  const request: { user?: CurrentUser } = {
    user: { id: 'u', role, team: null },
  };
  const context = {
    getHandler: () => route.handler,
    getClass: () => route.controllerClass,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return guard.canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

/*
  The sales roles' access as it stood before ADR-0084, written out by hand — deliberately
  not read from the @Roles() metadata, so a gate added to or removed from a sales route
  fails here instead of silently moving what an existing role can reach.
*/
const ADMIN_ONLY_CONTROLLERS = new Set([
  'AssignmentRulesController',
  'CategoriesController',
  'LeadFormsController',
  'LeadSourcesController',
  'MessageTemplatesController',
  'PipelinesController',
  'RolesController',
  'SettingsController',
  'TagsController',
  'UsersController',
]);
const OPEN_ON_ADMIN_CONTROLLERS = new Set([
  'GET /api/lead-forms/default',
  'GET /api/settings/activity-reminders/workflow',
]);
const ADMIN_ONLY_ROUTES = new Set([
  'PATCH /api/integrations/:id',
  'GET /api/lead-custom-fields/page',
  'PATCH /api/lead-custom-fields/:id',
  'DELETE /api/lead-custom-fields/:id',
]);
const MANAGER_AND_ADMIN_ROUTES = new Set([
  'POST /api/leads/bulk/reassign',
  'POST /api/leads/:id/reassign',
  'POST /api/stages',
  'PATCH /api/stages/reorder',
  'PATCH /api/stages/:id',
  'DELETE /api/stages/:id',
]);

/*
  Phase 3 (ADR-0085): the Logistics routes are the first to name an operational role, so the
  rule "an operational role reaches nothing but Documents" now has a second, deliberate
  exception. Written out by hand like the sales table above, so a role added to — or dropped
  from — a Logistics route fails here rather than quietly changing who can ship an order.
*/
const LOGISTICS_READ_LABELS = new Set([
  'GET /api/logistics/orders',
  'GET /api/logistics/orders/:id',
]);
const LOGISTICS_QC_LABELS = new Set([
  'POST /api/logistics/orders/:id/qc-verify',
  'POST /api/logistics/orders/:id/qc-reject',
]);
/* Both Logistics roles (client clarification 2026-10-01, Q1). */
const LOGISTICS_SHIPMENT_LABELS = new Set([
  'POST /api/logistics/orders/:id/dispatch',
  'POST /api/logistics/orders/:id/deliver',
  'POST /api/logistics/orders/:id/cancel',
]);
/* The Logistics Manager alone: RTO, the QC-verified edit (Q5), the AWB correction (Q9). */
const LOGISTICS_MANAGER_LABELS = new Set([
  'POST /api/logistics/orders/:id/rto',
  'PATCH /api/logistics/orders/:id',
  'PATCH /api/logistics/orders/:id/awb',
]);
/* The Sales Manager, on their own team's orders (Q1). */
const LOGISTICS_RESUBMIT_LABELS = new Set([
  'POST /api/logistics/orders/:id/resubmit',
]);

/*
  The journey read (ADR-0083): the same readers as an order — every sales role on their own
  leads, both Logistics roles and QC on the orders they work — because it returns the history of the
  records those two scopes already grant. Accounts is not named until its own phase.
*/
const JOURNEY_LABELS = new Set(['GET /api/audit/events']);

function isLogisticsRoute(label: string): boolean {
  return (
    LOGISTICS_READ_LABELS.has(label) ||
    JOURNEY_LABELS.has(label) ||
    LOGISTICS_QC_LABELS.has(label) ||
    LOGISTICS_SHIPMENT_LABELS.has(label) ||
    LOGISTICS_MANAGER_LABELS.has(label) ||
    LOGISTICS_RESUBMIT_LABELS.has(label)
  );
}

/**
 * Who each Logistics route admits: QC checks, both Logistics roles ship, the Manager corrects
 * and records RTO, the Sales Manager resubmits, and every other sales role only reads.
 */
function logisticsAdmits(label: string, role: UserRole): boolean {
  if (role === UserRole.SUPERADMIN) return isLogisticsRoute(label);
  if (LOGISTICS_READ_LABELS.has(label) || JOURNEY_LABELS.has(label)) {
    return role !== UserRole.ACCOUNTS_EXECUTIVE;
  }
  if (LOGISTICS_QC_LABELS.has(label)) return role === UserRole.QC;
  if (LOGISTICS_SHIPMENT_LABELS.has(label)) {
    return (
      role === UserRole.LOGISTICS_MANAGER ||
      role === UserRole.LOGISTICS_EXECUTIVE
    );
  }
  if (LOGISTICS_MANAGER_LABELS.has(label)) {
    return role === UserRole.LOGISTICS_MANAGER;
  }
  if (LOGISTICS_RESUBMIT_LABELS.has(label)) {
    return role === UserRole.SALES_MANAGER;
  }
  return false;
}

function admittedBefore(route: Route, role: UserRole): boolean {
  if (isLogisticsRoute(route.label)) return logisticsAdmits(route.label, role);
  if (role === UserRole.SUPERADMIN) return true;
  const adminOnly =
    (ADMIN_ONLY_CONTROLLERS.has(route.controller) &&
      !OPEN_ON_ADMIN_CONTROLLERS.has(route.label)) ||
    ADMIN_ONLY_ROUTES.has(route.label);
  if (adminOnly) return false;
  if (MANAGER_AND_ADMIN_ROUTES.has(route.label)) {
    return role === UserRole.SALES_MANAGER;
  }
  return true;
}

describe('Operational roles across every route (ADR-0084)', () => {
  it('discovers the whole route table, including the sales routes that must stay shut', () => {
    const labels = new Set(ROUTES.map((route) => route.label));
    for (const expected of [
      'GET /api/leads',
      'GET /api/leads/:id',
      'POST /api/leads',
      'PUT /api/leads/:id',
      'POST /api/leads/:id/status',
      'POST /api/leads/:id/pipeline',
      'DELETE /api/leads/:id',
      'GET /api/leads/board',
      'PATCH /api/leads/:id/stage',
      'POST /api/leads/bulk/reassign',
      'POST /api/leads/bulk/delete',
      'POST /api/leads/import',
      'GET /api/leads/export',
      'GET /api/activities',
      'GET /api/calls/log',
      'GET /api/reports/leads/by-ownership',
      'GET /api/dashboard/kpis',
      'GET /api/assignment-rules',
      'POST /api/stages',
      'PATCH /api/stages/:id',
      'PATCH /api/stages/reorder',
      'DELETE /api/stages/:id',
      'POST /api/pipelines',
      'PATCH /api/pipelines/:id',
      'DELETE /api/pipelines/:id',
      'POST /api/lead-custom-fields',
      'GET /api/lead-forms/default',
      'GET /api/settings/activity-reminders/workflow',
      ...LOGISTICS_READ_LABELS,
      ...JOURNEY_LABELS,
      ...LOGISTICS_QC_LABELS,
      ...LOGISTICS_SHIPMENT_LABELS,
      ...LOGISTICS_MANAGER_LABELS,
      ...LOGISTICS_RESUBMIT_LABELS,
    ]) {
      expect(labels).toContain(expected);
    }
  });

  /*
    The groups are what RolesGuard reads, so they are pinned by hand: a role dropped from
    OPERATIONAL_ROLES would otherwise just vanish from the loop below while gaining the sales
    routes' default-open access — QC's refusal on every lead route rests on this list.
  */
  it('classifies every role exactly once, QC among the operational roles', () => {
    expect([...OPERATIONAL_ROLES]).toEqual([
      UserRole.LOGISTICS_MANAGER,
      UserRole.LOGISTICS_EXECUTIVE,
      UserRole.ACCOUNTS_EXECUTIVE,
      UserRole.QC,
    ]);
    expect([...OPERATIONAL_ROLES, ...SALES_MODULE_ROLES].sort()).toEqual(
      Object.values(UserRole).sort(),
    );
  });

  describe.each(OPERATIONAL_ROLES)('%s', (role) => {
    it('reaches nothing outside Documents but the Logistics routes that name it', () => {
      const opened = ROUTES.filter(
        (route) =>
          !isPublic(route) &&
          route.controller !== 'DocumentsController' &&
          admits(route, role),
      ).map((route) => route.label);
      const expected = ROUTES.filter((route) =>
        logisticsAdmits(route.label, role),
      ).map((route) => route.label);
      expect(opened.sort()).toEqual(expected.sort());
    });

    it('keeps its owner-or-granted Documents routes', () => {
      const documents = ROUTES.filter(
        (route) => route.controller === 'DocumentsController',
      );
      expect(documents.length).toBeGreaterThan(0);
      for (const route of documents) expect(admits(route, role)).toBe(true);
    });
  });

  describe.each(SALES_MODULE_ROLES)('%s', (role) => {
    it('gets the same decision as before on every route', () => {
      const moved = ROUTES.filter(
        (route) =>
          !isPublic(route) &&
          admits(route, role) !== admittedBefore(route, role),
      ).map((route) => route.label);
      expect(moved).toEqual([]);
    });
  });
});
