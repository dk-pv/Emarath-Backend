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
  AuditState,
  RENAME,
  recordAuditEvents,
  recordStateChange,
  stateChangeEvents,
  userActor,
} from '../audit/audit-events';
import {
  CategoryNode,
  CreateCategoryDto,
  MoveCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

const CATEGORY_SELECT = {
  id: true,
  name: true,
  parentId: true,
  position: true,
  isActive: true,
  createdAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

/** What a category's audit events compare and record (AUD-04). */
const STATE_SELECT = {
  name: true,
  parentId: true,
  isActive: true,
  position: true,
} satisfies Prisma.CategorySelect;

function categoryState(
  row: Prisma.CategoryGetPayload<{ select: typeof STATE_SELECT }>,
): AuditState {
  return {
    name: row.name,
    parentId: row.parentId,
    isActive: row.isActive,
    position: row.position,
  };
}

const categoryEvent = (id: string, actor: AuditActor, source: string) => ({
  entityType: 'CATEGORY' as const,
  entityId: id,
  leadId: null,
  actor,
  source,
});

/**
 * The enquiry Category catalogue behind Settings → Sales & CRM Configuration → Category.
 *
 * The same contract `StagesService` holds for stages: a category's `name` is the value a
 * lead stores in `Lead.category`, so a rename cascades to those leads in one transaction,
 * and a delete is refused while any lead still carries the name. Neither the list, the
 * filters nor a report can end up pointing at a category that no longer exists.
 *
 * Hierarchy rules live here rather than in the UI — cycles are refused, and a delete is
 * also refused while the category has children, because re-parenting orphans on the user's
 * behalf would guess at a structure decision that is not ours to make.
 *
 * The tree is a small bounded set, so the graph work runs in memory over one `findMany`
 * instead of a recursive CTE: one round trip, one consistent snapshot.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The whole catalogue in sibling order, with depth, child flag and lead counts. */
  async list(): Promise<CategoryNode[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.category.findMany({
        select: CATEGORY_SELECT,
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.leadCounts(),
    ]);
    return this.toNodes(rows, counts);
  }

  /** Adds a category, appended after its last sibling so it lands where the user expects. */
  async create(dto: CreateCategoryDto): Promise<CategoryNode> {
    const actor = await this.currentUser.resolve();
    const rows = await this.loadGraph();
    await this.assertNameFree(dto.name);

    if (dto.parentId !== undefined) this.requireCategory(rows, dto.parentId);

    const parentId = dto.parentId ?? null;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.category.create({
        data: {
          name: dto.name.trim(),
          parentId,
          isActive: dto.isActive ?? true,
          position: this.nextPosition(rows, parentId),
          createdById: actor.id,
        },
        select: { id: true, ...STATE_SELECT },
      });
      await recordAuditEvents(tx, [
        {
          ...categoryEvent(row.id, userActor(actor), 'categories.create'),
          action: 'CREATED',
          after: categoryState(row),
        },
      ]);
      return row;
    });

    return this.requireNode(created.id);
  }

  /**
   * Renames, re-points or re-parents one category.
   *
   * A rename and its lead cascade succeed or fail together: a category's name and the
   * leads pointing at it must never end up out of step.
   *
   * Recorded in the same transaction, compared under a lock on the row (AUD-04): a new name is
   * one RENAMED, carrying how many leads it relabelled; a changed Active switch or parent is an
   * UPDATED; a save that changes nothing records nothing.
   */
  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryNode> {
    const rows = await this.loadGraph();
    const category = this.requireCategory(rows, id);

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.parentId !== undefined) {
      const nextParent = dto.parentId ?? null;
      this.assertReparentAllowed(rows, id, nextParent);
      data.parent =
        nextParent === null
          ? { disconnect: true }
          : { connect: { id: nextParent } };
      if (nextParent !== category.parentId) {
        data.position = this.nextPosition(rows, nextParent);
      }
    }

    const newName = dto.name?.trim();
    const renaming = newName !== undefined && newName !== category.name;
    if (renaming) {
      await this.assertNameFree(newName, id);
      data.name = newName;
    }

    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.category.findUniqueOrThrow({
        where: { id },
        select: STATE_SELECT,
      });
      const after = await tx.category.update({
        where: { id },
        data,
        select: STATE_SELECT,
      });
      const relabelled = renaming
        ? await tx.lead.updateMany({
            where: { category: before.name },
            data: { category: after.name },
          })
        : null;
      await recordStateChange(
        tx,
        {
          ...categoryEvent(id, actor, 'categories.update'),
          ...(relabelled
            ? { metadata: { leadsRelabelled: relabelled.count } }
            : {}),
        },
        categoryState(before),
        categoryState(after),
        [RENAME],
      );
    });
    return this.requireNode(id);
  }

  /**
   * Drag/drop landing: re-parent if asked, then slot the category among its siblings and
   * renumber that list so positions stay dense and stable.
   */
  async move(id: string, dto: MoveCategoryDto): Promise<CategoryNode[]> {
    const rows = await this.loadGraph();
    const category = this.requireCategory(rows, id);
    const nextParent =
      dto.parentId === undefined ? category.parentId : dto.parentId;

    this.assertReparentAllowed(rows, id, nextParent);

    const siblings = rows
      .filter((r) => r.parentId === nextParent && r.id !== id)
      .sort((a, b) => a.position - b.position);
    const index = Math.min(Math.max(dto.position, 0), siblings.length);
    siblings.splice(index, 0, { ...category, parentId: nextParent });

    // Only the dragged category is recorded, as a dragged role is (AUD-01): its siblings'
    // renumbering follows from it. Its place is its parent and its index among its siblings, so
    // dropping it back where it was records nothing (AUD-04).
    const actor = userActor(await this.currentUser.resolve());
    const fromIndex = rows
      .filter((r) => r.parentId === category.parentId)
      .sort((a, b) => a.position - b.position)
      .findIndex((r) => r.id === id);
    const moved = stateChangeEvents(
      categoryEvent(id, actor, 'categories.move'),
      { parentId: category.parentId, position: fromIndex },
      { parentId: nextParent, position: index },
    ).map((event) => ({ ...event, action: 'MOVED' as const }));

    // One transaction: a half-applied reorder would leave duplicate positions behind.
    await this.prisma.$transaction([
      ...siblings.map((sibling, order) =>
        this.prisma.category.update({
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
   * Removes a category, but only when nothing depends on it.
   *
   * Child categories and leads both block. Cascading would delete structure the user did
   * not ask to lose, and clearing `Lead.category` would silently rewrite business data —
   * so the refusal names the count instead, and the user decides.
   */
  async remove(id: string): Promise<{ id: string }> {
    const rows = await this.loadGraph();
    const category = this.requireCategory(rows, id);

    const children = rows.filter((r) => r.parentId === id).length;
    if (children > 0) {
      throw new ConflictException(
        `This category has ${children} sub-categor${children === 1 ? 'y' : 'ies'} beneath it. Move or delete them first.`,
      );
    }

    const inUse = await this.prisma.lead.count({
      where: { category: category.name, deletedAt: null },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `This category is used by ${inUse} lead${inUse === 1 ? '' : 's'}. Recategorise them before deleting it.`,
      );
    }

    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.category.delete({
        where: { id },
        select: STATE_SELECT,
      });
      await recordAuditEvents(tx, [
        {
          ...categoryEvent(id, actor, 'categories.delete'),
          action: 'DELETED',
          before: categoryState(removed),
        },
      ]);
    });
    return { id };
  }

  // ---------- internals ----------

  /** Just the shape the graph rules need: id, name, parent and sibling order. */
  private loadGraph(): Promise<
    { id: string; name: string; parentId: string | null; position: number }[]
  > {
    return this.prisma.category.findMany({
      select: { id: true, name: true, parentId: true, position: true },
      orderBy: { position: 'asc' },
    });
  }

  /** Live leads per category name, in one grouped query rather than one per row. */
  private async leadCounts(): Promise<Map<string, number>> {
    const grouped = await this.prisma.lead.groupBy({
      by: ['category'],
      where: { deletedAt: null, category: { not: null } },
      _count: { _all: true },
    });
    return new Map(
      grouped
        .filter(
          (row): row is typeof row & { category: string } =>
            row.category !== null,
        )
        .map((row) => [row.category, row._count._all]),
    );
  }

  private requireCategory<T extends { id: string }>(rows: T[], id: string): T {
    const found = rows.find((r) => r.id === id);
    if (!found) throw new NotFoundException('Category not found.');
    return found;
  }

  private async requireNode(id: string): Promise<CategoryNode> {
    const node = (await this.list()).find((r) => r.id === id);
    if (!node) throw new NotFoundException('Category not found.');
    return node;
  }

  /**
   * Names identify a category to every lead, so a clash is refused rather than allowed to
   * make two rows indistinguishable. Case-insensitive: "Logistics" and "logistics" would
   * read as the same category to a person looking at the list.
   */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.category.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `A category named “${name.trim()}” already exists.`,
      );
    }
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

  /**
   * Rejects the two moves that would corrupt the tree: onto itself, or into its own
   * subtree — which would detach that branch from every root. Enforced here because the
   * client cannot be trusted with structural invariants.
   */
  private assertReparentAllowed(
    rows: { id: string; parentId: string | null }[],
    id: string,
    parentId: string | null,
  ): void {
    if (parentId === null) return;
    if (parentId === id) {
      throw new BadRequestException('A category cannot be its own parent.');
    }

    const parent = this.requireCategory(rows, parentId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set<string>();
    let cursor: string | null = parent.id;
    while (cursor && !seen.has(cursor)) {
      if (cursor === id) {
        throw new BadRequestException(
          'A category cannot be moved beneath one of its own descendants.',
        );
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  /** Adds the derived fields the tree renders: depth, child flag, lead count, author. */
  private toNodes(
    rows: CategoryRow[],
    counts: Map<string, number>,
  ): CategoryNode[] {
    const parents = rows.map((r) => ({ id: r.id, parentId: r.parentId }));
    const withChildren = new Set(
      rows.map((r) => r.parentId).filter((p): p is string => p !== null),
    );
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        position: row.position,
        level: this.depthOf(parents, row.id),
        isActive: row.isActive,
        hasChildren: withChildren.has(row.id),
        leadCount: counts.get(row.name) ?? 0,
        createdByName: row.createdBy?.name ?? null,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.level - b.level || a.position - b.position);
  }
}
