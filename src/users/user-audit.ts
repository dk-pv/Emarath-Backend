import { Prisma } from '../generated/prisma/client';
import {
  AuditActor,
  AuditEventInput,
  AuditState,
  stateChangeEvents,
} from '../audit/audit-events';

/**
 * Team member history (AUD-01, ADR-0083): every account change is recorded in the transaction
 * that makes it, as the difference between the account read before and after under a row lock —
 * the lead pattern (`lead-audit.ts`) applied to users.
 *
 * Credentials are never part of the state: `passwordHash` is not selected, so no event can carry
 * it; a password change is recorded as the bare fact (PASSWORD_CHANGED / PASSWORD_RESET).
 */
export const USER_AUDIT_SELECT = {
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  role: true,
  roleId: true,
  jobTitle: true,
  phone: true,
  team: true,
  isActive: true,
  reportingToId: true,
  leadFormId: true,
  pipelines: true,
  appAccess: true,
  includeInReporting: true,
  autoFollowUpPrompt: true,
  whatsappInboxAccess: true,
  colorCode: true,
  monthlyGoalAmount: true,
  avatarKey: true,
  modulePermissions: {
    select: { module: true, canView: true, canAdd: true, canEdit: true },
  },
} satisfies Prisma.UserSelect;

type UserAuditRow = Prisma.UserGetPayload<{
  select: typeof USER_AUDIT_SELECT;
}>;

export function toUserAuditState(row: UserAuditRow): AuditState {
  return {
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    username: row.username,
    role: row.role,
    roleId: row.roleId,
    jobTitle: row.jobTitle,
    phone: row.phone,
    team: row.team,
    isActive: row.isActive,
    reportingToId: row.reportingToId,
    leadFormId: row.leadFormId,
    pipelines: [...row.pipelines].sort(),
    appAccess: row.appAccess,
    includeInReporting: row.includeInReporting,
    autoFollowUpPrompt: row.autoFollowUpPrompt,
    whatsappInboxAccess: row.whatsappInboxAccess ?? null,
    colorCode: row.colorCode,
    monthlyGoalAmount: row.monthlyGoalAmount?.toString() ?? null,
    avatarKey: row.avatarKey,
    permissions: [...row.modulePermissions]
      .sort((a, b) => a.module.localeCompare(b.module))
      .map((entry) => ({
        module: entry.module,
        canView: entry.canView,
        canAdd: entry.canAdd,
        canEdit: entry.canEdit,
      })),
  };
}

/** Holds the account for the rest of the transaction, so the before-state is the real one. */
export async function lockUser(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function readUserAuditState(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<AuditState> {
  return toUserAuditState(
    await tx.user.findUniqueOrThrow({
      where: { id },
      select: USER_AUDIT_SELECT,
    }),
  );
}

/** The access grants: the module matrix, pipeline grants, app and WhatsApp inbox access. */
const PERMISSION_FIELDS = [
  'permissions',
  'pipelines',
  'appAccess',
  'whatsappInboxAccess',
] as const;

export function userChangeEvents(
  id: string,
  before: AuditState,
  after: AuditState,
  actor: AuditActor,
  source: string,
): AuditEventInput[] {
  return stateChangeEvents(
    { entityType: 'USER', entityId: id, leadId: null, actor, source },
    before,
    after,
    [
      ['ROLE_CHANGED', ['role', 'roleId']],
      ['PERMISSIONS_CHANGED', PERMISSION_FIELDS],
      [after.isActive ? 'ACTIVATED' : 'DEACTIVATED', ['isActive']],
    ],
  );
}

export function userEvent(
  id: string,
  action: AuditEventInput['action'],
  actor: AuditActor,
  source: string,
  states: { before?: AuditState; after?: AuditState } = {},
): AuditEventInput {
  return {
    entityType: 'USER',
    entityId: id,
    leadId: null,
    action,
    actor,
    source,
    before: states.before,
    after: states.after,
  };
}
