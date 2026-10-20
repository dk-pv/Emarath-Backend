import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditActor,
  AuditEventInput,
  AuditState,
  recordAuditEvents,
  stateChangeEvents,
  userActor,
} from '../audit/audit-events';
import {
  CreateRoleDto,
  MAX_ROLE_DEPTH,
  MoveRoleDto,
  RoleNode,
  UpdateRoleDto,
} from './dto/role.dto';

/** What the tree needs from every row, plus the live-user count behind the badge. */
const ROLE_SELECT = {
  id: true,
  name: true,
  baseRole: true,
  parentId: true,
  position: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  _count: { select: { users: { where: { deletedAt: null } } } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

/** A role as its history records it (AUD-01): what it is called, grants and hangs under. */
function roleState(role: {
  name: string;
  baseRole: string;
  parentId: string | null;
}): AuditState {
  return { name: role.name, baseRole: role.baseRole, parentId: role.parentId };
}

function roleEvent(
  id: string,
  action: AuditEventInput['action'],
  actor: AuditActor,
  source: string,
  states: { before?: AuditState; after?: AuditState },
): AuditEventInput {
  return {
    entityType: 'ROLE',
    entityId: id,
    leadId: null,
    action,
    actor,
    source,
    ...states,
  };
}

/**
 * The role hierarchy behind Settings → Users & Access → Roles & Permissions (ADR-0056).
 *
 * Every structural rule is enforced here rather than in the UI: depth, cycles, name
 * collisions and delete safety. The tree is a small bounded set (one row per named role),
 * so the graph work runs in memory over one `findMany` instead of a recursive CTE — one
 * round trip, and the same snapshot answers depth and cycle questions consistently.
 *
 * Soft delete has no automatic filter (CLAUDE.md §11), so every query names
 * `deletedAt: null` — including the parent lookups, so a removed role can never become
 * the parent of a live one.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The whole hierarchy, ordered so siblings arrive in their stored order. */
  async list(): Promise<RoleNode[]> {
    const rows = await this.prisma.role.findMany({
      where: { deletedAt: null },
      select: ROLE_SELECT,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return this.toNodes(rows);
  }

  /** Creates a role, appended after its last sibling so it lands where the user expects. */
  async create(dto: CreateRoleDto): Promise<RoleNode> {
    const actor = await this.currentUser.resolve();
    const rows = await this.loadGraph();
    await this.assertNameFree(dto.name);

    if (dto.parentId !== undefined) {
      const parent = this.requireRole(rows, dto.parentId);
      if (this.depthOf(rows, parent.id) + 1 > MAX_ROLE_DEPTH) {
        throw new BadRequestException(
          `A role cannot sit deeper than level ${MAX_ROLE_DEPTH}.`,
        );
      }
    }

    const parentId = dto.parentId ?? null;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.role.create({
        data: {
          name: dto.name.trim(),
          baseRole: dto.baseRole,
          parentId,
          position: this.nextPosition(rows, parentId),
          createdById: actor.id,
        },
        select: { id: true, name: true, baseRole: true, parentId: true },
      });
      await recordAuditEvents(tx, [
        roleEvent(row.id, 'CREATED', userActor(actor), 'roles.create', {
          after: roleState(row),
        }),
      ]);
      return row;
    });

    return this.requireNode(created.id);
  }

  /** Renames, re-points or re-parents one role. */
  async update(id: string, dto: UpdateRoleDto): Promise<RoleNode> {
    const rows = await this.loadGraph();
    const role = this.requireRole(rows, id);

    if (dto.name !== undefined && dto.name.trim() !== role.name) {
      await this.assertNameFree(dto.name, id);
    }

    const data: Prisma.RoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.baseRole !== undefined) data.baseRole = dto.baseRole;

    // `parentId` present means "re-parent" (null promotes to root); absent means "leave it".
    if (dto.parentId !== undefined) {
      const nextParent = dto.parentId ?? null;
      this.assertReparentAllowed(rows, id, nextParent);
      data.parent =
        nextParent === null
          ? { disconnect: true }
          : { connect: { id: nextParent } };
      if (nextParent !== role.parentId) {
        data.position = this.nextPosition(rows, nextParent);
      }
    }

    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM roles WHERE id = ${id}::uuid FOR UPDATE`;
      const select = { name: true, baseRole: true, parentId: true } as const;
      const before = await tx.role.findUniqueOrThrow({ where: { id }, select });
      const after = await tx.role.update({ where: { id }, data, select });
      const events = stateChangeEvents(
        {
          entityType: 'ROLE',
          entityId: id,
          leadId: null,
          actor,
          source: 'roles.update',
        },
        roleState(before),
        roleState(after),
      );
      if (events.length > 0) await recordAuditEvents(tx, events);
    });
    return this.requireNode(id);
  }

  /**
   * Drag/drop landing: re-parent if asked, then slot the role among its siblings and
   * renumber that sibling list so positions stay dense and stable.
   */
  async move(id: string, dto: MoveRoleDto): Promise<RoleNode[]> {
    const rows = await this.loadGraph();
    const role = this.requireRole(rows, id);
    const nextParent =
      dto.parentId === undefined ? role.parentId : dto.parentId;

    this.assertReparentAllowed(rows, id, nextParent);

    const siblings = rows
      .filter((r) => r.parentId === nextParent && r.id !== id)
      .sort((a, b) => a.position - b.position);
    const index = Math.min(Math.max(dto.position, 0), siblings.length);
    siblings.splice(index, 0, { ...role, parentId: nextParent });

    // Only the dragged role is recorded: its siblings' renumbering is a consequence of it.
    const actor = userActor(await this.currentUser.resolve());
    const moved = stateChangeEvents(
      {
        entityType: 'ROLE',
        entityId: id,
        leadId: null,
        actor,
        source: 'roles.move',
      },
      { parentId: role.parentId, position: role.position },
      { parentId: nextParent, position: index },
    ).map((event) => ({ ...event, action: 'MOVED' as const }));

    // One transaction: a half-applied reorder would leave duplicate positions behind.
    await this.prisma.$transaction([
      ...siblings.map((sibling, order) =>
        this.prisma.role.update({
          where: { id: sibling.id },
          data: { parentId: nextParent, position: order },
          select: { id: true },
        }),
      ),
      ...(moved.length > 0 ? [recordAuditEvents(this.prisma, moved)] : []),
    ]);

    return this.list();
  }

  /**
   * Removes a role, but only when nothing depends on it.
   *
   * Children and assigned users both block: cascading would silently strip privileges
   * from real accounts, and re-parenting orphans on the user's behalf would guess at an
   * org-structure decision that is not ours to make. Soft delete (`deletedAt`) matches
   * every other model, so the row survives for audit.
   */
  async remove(id: string): Promise<{ id: string }> {
    const rows = await this.loadGraph();
    this.requireRole(rows, id);

    if (rows.some((r) => r.parentId === id)) {
      throw new ConflictException(
        'This role still has roles beneath it. Move or remove them first.',
      );
    }

    const assigned = await this.prisma.user.count({
      where: { roleId: id, deletedAt: null },
    });
    if (assigned > 0) {
      throw new ConflictException(
        `This role is assigned to ${assigned} team member${assigned === 1 ? '' : 's'}. Reassign them first.`,
      );
    }

    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.role.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (removed.count !== 1) throw new NotFoundException('Role not found.');
      const before = await tx.role.findUniqueOrThrow({
        where: { id },
        select: { name: true, baseRole: true, parentId: true },
      });
      await recordAuditEvents(tx, [
        roleEvent(id, 'DELETED', actor, 'roles.delete', {
          before: roleState(before),
        }),
      ]);
    });
    return { id };
  }

  // ---------- internals ----------

  /** Just the shape the graph rules need: id, parent and sibling order. */
  private loadGraph(): Promise<
    { id: string; name: string; parentId: string | null; position: number }[]
  > {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, parentId: true, position: true },
      orderBy: { position: 'asc' },
    });
  }

  private requireRole<T extends { id: string }>(rows: T[], id: string): T {
    const found = rows.find((r) => r.id === id);
    if (!found) throw new NotFoundException('Role not found.');
    return found;
  }

  private async requireNode(id: string): Promise<RoleNode> {
    const node = (await this.list()).find((r) => r.id === id);
    if (!node) throw new NotFoundException('Role not found.');
    return node;
  }

  /**
   * The unique index covers soft-deleted rows too, so a name freed by a delete is still
   * taken at the database level. Checking every row turns what would surface as a 500
   * into a 409 that says which case it is.
   */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.role.findFirst({
      where: {
        name: name.trim(),
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, deletedAt: true },
    });
    if (!clash) return;
    throw new ConflictException(
      clash.deletedAt
        ? 'That name belonged to a removed role and cannot be reused.'
        : 'A role with that name already exists.',
    );
  }

  /** Next free slot at the end of a sibling list. */
  private nextPosition(
    rows: { parentId: string | null; position: number }[],
    parentId: string | null,
  ): number {
    const siblings = rows.filter((r) => r.parentId === parentId);
    return siblings.length === 0
      ? 0
      : Math.max(...siblings.map((s) => s.position)) + 1;
  }

  /** 1-based depth, walking parents with a visited guard so stored data cannot hang us. */
  private depthOf(
    rows: { id: string; parentId: string | null }[],
    id: string,
  ): number {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set<string>();
    let depth = 1;
    let current = byId.get(id)?.parentId ?? null;
    while (current && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = byId.get(current)?.parentId ?? null;
    }
    return depth;
  }

  /** Tallest branch below a role, so a moved subtree cannot overflow the depth limit. */
  private heightOf(
    rows: { id: string; parentId: string | null }[],
    id: string,
  ): number {
    const children = rows.filter((r) => r.parentId === id);
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map((c) => this.heightOf(rows, c.id)));
  }

  /**
   * Rejects the three moves that would corrupt the tree: onto itself, into its own
   * subtree (which would detach that branch from the root entirely), or past the level
   * cap. Enforced here because the client cannot be trusted with structural invariants.
   */
  private assertReparentAllowed(
    rows: { id: string; parentId: string | null }[],
    id: string,
    parentId: string | null,
  ): void {
    if (parentId === null) return;
    if (parentId === id) {
      throw new BadRequestException('A role cannot be its own parent.');
    }

    const parent = this.requireRole(rows, parentId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set<string>();
    let cursor: string | null = parent.id;
    while (cursor && !seen.has(cursor)) {
      if (cursor === id) {
        throw new BadRequestException(
          'A role cannot be moved beneath one of its own descendants.',
        );
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }

    if (
      this.depthOf(rows, parent.id) + this.heightOf(rows, id) >
      MAX_ROLE_DEPTH
    ) {
      throw new BadRequestException(
        `That move would push roles past level ${MAX_ROLE_DEPTH}.`,
      );
    }
  }

  /** Adds the derived fields the tree renders: depth, child flag, author name. */
  private toNodes(rows: RoleRow[]): RoleNode[] {
    const parents = rows.map((r) => ({ id: r.id, parentId: r.parentId }));
    const withChildren = new Set(
      rows.map((r) => r.parentId).filter((p): p is string => p !== null),
    );
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        baseRole: row.baseRole,
        parentId: row.parentId,
        position: row.position,
        level: this.depthOf(parents, row.id),
        assignedCount: row._count.users,
        hasChildren: withChildren.has(row.id),
        createdByName: row.createdBy?.name ?? null,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.level - b.level || a.position - b.position);
  }
}
