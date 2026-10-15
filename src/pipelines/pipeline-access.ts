import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { isOperationalRole, PIPELINE_MOVE_ROLES } from '../auth/role-groups';
import type { PermissionType, PipelineAccessMode } from './dto/pipeline.dto';

const SPECIFIC: PipelineAccessMode = 'SPECIFIC';
const ROLE_GRANT: PermissionType = 'ROLE';
const USER_GRANT: PermissionType = 'USER';

/**
 * The pipelines `userId` may not open (ADR-0093): every Specific pipeline that grants them
 * nothing, so one with no grants at all is open to the admin alone (B7). A USER grant names
 * them; a ROLE grant counts only through their own organisational role (`User.roleId`), and only
 * while that role is not deleted, never through the UserRole enum (B1). An All users pipeline
 * holds no grants and is never closed.
 *
 * Read from the database on every request, never carried in the token, so a grant an admin adds
 * or removes applies from the user's next request.
 */
export async function deniedPipelines(
  client: Pick<Prisma.TransactionClient, 'pipeline'>,
  userId: string,
): Promise<string[]> {
  const rows = await client.pipeline.findMany({
    where: {
      accessMode: SPECIFIC,
      permissions: {
        none: {
          OR: [
            { permissionType: USER_GRANT, userId },
            {
              permissionType: ROLE_GRANT,
              role: { deletedAt: null, users: { some: { id: userId } } },
            },
          ],
        },
      },
    },
    select: { name: true },
  });
  return rows.map((row) => row.name);
}

/**
 * `user` with the pipelines closed to them attached (`CurrentUser.deniedPipelines`). The admin
 * bypasses every grant (B1) and the operational roles see no lead at all, so neither costs a
 * query.
 */
export async function withPipelineAccess<T extends CurrentUser>(
  client: Pick<Prisma.TransactionClient, 'pipeline'>,
  user: T,
): Promise<T> {
  if (user.role === UserRole.SUPERADMIN || isOperationalRole(user.role)) {
    return user;
  }
  return { ...user, deniedPipelines: await deniedPipelines(client, user.id) };
}

/**
 * Leaves out the rows in pipelines closed to `user`, for any model that stores a pipeline name
 * (`Lead`, `ImportJob`). Empty when nothing is closed to them, so an All users catalogue adds
 * no condition at all, and always empty for the admin.
 */
export function openPipelinesWhere(user: CurrentUser): {
  pipeline?: { notIn: string[] };
} {
  return user.role !== UserRole.SUPERADMIN && user.deniedPipelines?.length
    ? { pipeline: { notIn: [...user.deniedPipelines] } }
    : {};
}

function isClosed(user: CurrentUser, pipeline: string): boolean {
  return (
    user.role !== UserRole.SUPERADMIN &&
    (user.deniedPipelines?.includes(pipeline) ?? false)
  );
}

/**
 * Refuses putting a lead in `pipeline`, or managing its stages, when it is closed to the caller:
 * create, import, Duplicate, the target of a move, stage management (B6, B9, B10). Checked on
 * the server whatever the pickers offer.
 */
export function assertPipelineOpen(user: CurrentUser, pipeline: string): void {
  if (isClosed(user, pipeline)) {
    throw new ForbiddenException(
      `You don't have access to the "${pipeline}" pipeline.`,
    );
  }
}

/**
 * Refuses changing a lead that sits in a pipeline closed to the caller. Only a sales agent can
 * reach one, through a lead assigned to them: the assignment lets them see it, not change it
 * (B2). Every other role's scope already leaves such leads out.
 */
export function assertMayChangeLead(
  user: CurrentUser,
  lead: { pipeline: string },
): void {
  if (isClosed(user, lead.pipeline)) {
    throw new ForbiddenException(
      `This lead is in the "${lead.pipeline}" pipeline, which you don't have access to. You can view it, but not change it.`,
    );
  }
}

/** Refuses a move to `target` unless the caller may move leads (B5) and may use `target`. */
export function assertMayMoveLead(user: CurrentUser, target: string): void {
  if (!PIPELINE_MOVE_ROLES.includes(user.role)) {
    throw new ForbiddenException(
      'Only a manager or an administrator can move a lead to another pipeline.',
    );
  }
  assertPipelineOpen(user, target);
}
