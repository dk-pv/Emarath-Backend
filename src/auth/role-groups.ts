import { Prisma, UserRole } from '../generated/prisma/client';

/**
 * The post-sale roles of the client CRM workflow (ADR-0084, plus QC from the 2026-10-01
 * clarification): they work the Logistics and Accounts pipelines and hold no access to the
 * sales modules. RolesGuard admits them only
 * to a route whose @Roles() names them, and every sales scope helper returns no rows for
 * them — so a sales route can never be reached by forgetting a decorator.
 */
export const OPERATIONAL_ROLES: readonly UserRole[] = [
  UserRole.LOGISTICS_MANAGER,
  UserRole.LOGISTICS_EXECUTIVE,
  UserRole.ACCOUNTS_EXECUTIVE,
  UserRole.QC,
];

/**
 * The roles the sales modules (leads, activities, calls, reports, dashboard) were
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

/**
 * Who may choose a lead's assignees: the Reassign actions' `@Roles` (AUTH-02.2 — "only managers
 * and admins see … reassignment tools"), and the New/Edit Lead form's Assigned field with them.
 */
export const REASSIGN_ROLES: readonly UserRole[] = [
  UserRole.SUPERADMIN,
  UserRole.SALES_MANAGER,
];

/**
 * Who may move a lead from one pipeline to another (ADR-0093 B5): Change Pipeline, and an edit
 * that changes the Pipeline field. Creating a lead in a pipeline is not a move.
 */
export const PIPELINE_MOVE_ROLES: readonly UserRole[] = [
  UserRole.SUPERADMIN,
  UserRole.SALES_MANAGER,
];

/**
 * Who may belong to a team (Teams v1): the sales roles the team label means something for — the
 * manager's team scope, team tag permissions, team targets. The administrator is never scoped by a
 * team, and the post-sale roles hold no sales access, so neither is placed in one.
 */
export const TEAM_MEMBER_ROLES: readonly UserRole[] = SALES_MODULE_ROLES.filter(
  (role) => role !== UserRole.SUPERADMIN,
);

/** Who a lead may be assigned to: the lead-handling roles (LEAD-06.2). */
export const ASSIGNABLE_ROLES: readonly UserRole[] = [
  UserRole.SALES_AGENT,
  UserRole.SALES_MANAGER,
  UserRole.CUSTOMER_SERVICE_AGENT,
];

/**
 * A user a lead may NEWLY be assigned to: not deleted, active, in an assignable role. The one
 * rule behind every way a lead gains an assignee — create, edit, Reassign (row and bulk),
 * automatic assignment, Duplicate — and behind the Assigned field's options. It is never applied
 * to an assignee a lead already has: deactivating a user leaves their leads as they are.
 */
export const ASSIGNABLE_USER_WHERE = {
  deletedAt: null,
  isActive: true,
  role: { in: [...ASSIGNABLE_ROLES] },
} satisfies Prisma.UserWhereInput;

export function isOperationalRole(role: UserRole | undefined): boolean {
  return role !== undefined && OPERATIONAL_ROLES.includes(role);
}
