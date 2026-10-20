import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditActor,
  RENAME,
  recordAuditEvents,
  recordStateChange,
  userActor,
} from '../audit/audit-events';
import { TagAccessService } from '../tag-access/tag-access.service';
import { CreateTagDto, TagNode, UpdateTagDto } from './dto/tag.dto';

/**
 * Counting through the relation rather than per row.
 *
 * `_count` becomes one correlated aggregate in the same query Prisma already issues for
 * the list, so the catalogue costs one round trip whatever its size — no per-tag count,
 * and no loading lead rows into memory to count them. The filter narrows it to live
 * leads, so a soft-deleted lead never inflates the number.
 */
const TAG_SELECT = {
  id: true,
  name: true,
  isActive: true,
  _count: { select: { leads: { where: { lead: { deletedAt: null } } } } },
} satisfies Prisma.TagSelect;

type TagRow = Prisma.TagGetPayload<{ select: typeof TAG_SELECT }>;

const tagEvent = (id: string, actor: AuditActor, source: string) => ({
  entityType: 'TAG' as const,
  entityId: id,
  leadId: null,
  actor,
  source,
});

/**
 * The Tags catalogue behind Settings → Sales & CRM Configuration → Tags.
 *
 * Unlike the other catalogues, a tag is referenced by **id**, not by name: `LeadTag` joins
 * lead to tag through foreign keys (LEAD-12.1). Two consequences follow, and they are the
 * whole reason this service differs from `LeadSourcesService`:
 *
 * - a rename needs no cascade — every lead link keeps pointing at the same row;
 * - a delete must be a *soft* delete, because `LeadTag.tag` cascades, so removing the row
 *   would silently strip the tag off every lead carrying it (ADR-0063).
 *
 * Soft-deleted tags are excluded everywhere: this list, the name-uniqueness check and the
 * `tags` lookup all filter `deletedAt: null`.
 */
@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly access: TagAccessService,
  ) {}

  /** The catalogue in name order — the order the reference table lists. */
  async list(): Promise<TagNode[]> {
    const rows = await this.prisma.tag.findMany({
      where: { deletedAt: null },
      select: TAG_SELECT,
      orderBy: { name: 'asc' },
    });
    return rows.map(toNode);
  }

  /**
   * An administrator creates exactly as before. Anyone else needs the Admin to have allowed
   * their team or them personally to create tags (ADR-0091), and gets a plain active
   * tag — the Active switch is a catalogue-management control, not theirs — which they can
   * select straight away (`grantToCreator`). The tag, that grant and the CREATED event commit
   * together; the event says whether the grant was made, since it changes the creator's tag
   * access policy (AUD-03).
   */
  async create(dto: CreateTagDto): Promise<TagNode> {
    const user = await this.currentUser.resolve();
    const name = dto.name.trim();

    const admin = user.role === UserRole.SUPERADMIN;
    if (!admin) await this.access.assertMayCreate(user);
    await this.assertNameFree(name);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tag.create({
        data: { name, isActive: admin ? (dto.isActive ?? true) : true },
        select: TAG_SELECT,
      });
      const granted = admin
        ? false
        : await this.access.grantToCreator(tx, user, row.id);
      await recordAuditEvents(tx, [
        {
          ...tagEvent(row.id, userActor(user), 'tags.create'),
          action: 'CREATED',
          after: { name: row.name, isActive: row.isActive },
          ...(granted ? { metadata: { accessGrantedToCreator: true } } : {}),
        },
      ]);
      return row;
    });
    return toNode(created);
  }

  /**
   * Renames and/or activates a tag.
   *
   * The row is updated in place, never recreated, so every `LeadTag` link survives a
   * rename untouched — which is exactly what an id-keyed catalogue buys. Recorded in the same
   * transaction under a lock on the row: a new name is a RENAMED, a changed Active switch an
   * UPDATED, and a save that changes nothing records nothing (AUD-03).
   */
  async update(id: string, dto: UpdateTagDto): Promise<TagNode> {
    const tag = await this.requireRow(id);

    const data: Prisma.TagUpdateInput = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const newName = dto.name?.trim();
    if (newName !== undefined && newName !== tag.name) {
      await this.assertNameFree(newName, id);
      data.name = newName;
    }

    const actor = userActor(await this.currentUser.resolve());
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tags WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.tag.findUniqueOrThrow({
        where: { id },
        select: { name: true, isActive: true },
      });
      const row = await tx.tag.update({
        where: { id },
        data,
        select: TAG_SELECT,
      });
      await recordStateChange(
        tx,
        tagEvent(id, actor, 'tags.update'),
        before,
        { name: row.name, isActive: row.isActive },
        [RENAME],
      );
      return row;
    });
    return toNode(updated);
  }

  /**
   * Retires a tag by stamping `deletedAt`.
   *
   * Deliberately not a row delete: `LeadTag.tag` is `onDelete: Cascade`, so removing the
   * tag would delete its join rows and silently strip the tag from every lead carrying
   * it. Stamping leaves those rows alone — no lead is deleted, and no lead's other tags
   * are affected. The tag leaves the catalogue and the lookup, and the leads that already
   * carry it keep their history.
   */
  async remove(id: string): Promise<{ id: string }> {
    await this.requireRow(id);
    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tags WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.tag.findUniqueOrThrow({
        where: { id },
        select: { name: true, isActive: true },
      });
      await tx.tag.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: { id: true },
      });
      await recordAuditEvents(tx, [
        {
          ...tagEvent(id, actor, 'tags.delete'),
          action: 'DELETED',
          before,
        },
      ]);
    });
    return { id };
  }

  // ---------- internals ----------

  private async requireRow(id: string) {
    const found = await this.prisma.tag.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!found) throw new NotFoundException('Tag not found.');
    return found;
  }

  /**
   * Case-insensitive, as the rest of the catalogues are: "BDE RISK" and "bde risk" would
   * read as the same tag to a person looking at the list. Soft-deleted rows are ignored,
   * so retiring a tag frees its name again.
   */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.tag.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `A tag named “${name.trim()}” already exists.`,
      );
    }
  }
}

function toNode(row: TagRow): TagNode {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    leadCount: row._count.leads,
  };
}
