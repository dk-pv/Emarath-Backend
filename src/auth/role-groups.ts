import { UserRole } from '../generated/prisma/client';

/**
 * The post-sale roles of the client CRM workflow (ADR-0084): they work the Logistics and
 * Accounts pipelines and hold no access to the sales modules. RolesGuard admits them only
 * to a route whose @Roles() names them, and every sales scope helper returns no rows for
 * them — so a sales route can never be reached by forgetting a decorator.
 */
export const OPERATIONAL_ROLES: readonly UserRole[] = [
  UserRole.LOGISTICS_MANAGER,
  UserRole.LOGISTICS_EXECUTIVE,
  UserRole.ACCOUNTS_EXECUTIVE,
];

/**
 * The roles the sales modules (leads, activities, calls, GPS, reports, dashboard) were
 * built for. Use it where a route must list every sales role — never `Object.values(UserRole)`,
 * which would silently admit each role added later.
 */
export const SALES_MODULE_ROLES: readonly UserRole[] = [
  UserRole.SUPERADMIN,
  UserRole.SALES_MANAGER,
  UserRole.SALES_AGENT,
  UserRole.CUSTOMER_SERVICE_AGENT,
  UserRole.MARKETING_ANALYST,
];

export function isOperationalRole(role: UserRole | undefined): boolean {
  return role !== undefined && OPERATIONAL_ROLES.includes(role);
}
