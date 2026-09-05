import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  /** The catalogue in name order — the order the reference table lists. */
  async list(): Promise<TagNode[]> {
    const rows = await this.prisma.tag.findMany({
      where: { deletedAt: null },
      select: TAG_SELECT,
      orderBy: { name: 'asc' },
    });
    return rows.map(toNode);
  }

  async create(dto: CreateTagDto): Promise<TagNode> {
    const name = dto.name.trim();
    await this.assertNameFree(name);

    const created = await this.prisma.tag.create({
      data: { name, isActive: dto.isActive ?? true },
      select: TAG_SELECT,
    });
    return toNode(created);
  }

  /**
   * Renames and/or activates a tag.
   *
   * The row is updated in place, never recreated, so every `LeadTag` link survives a
   * rename untouched — which is exactly what an id-keyed catalogue buys.
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

    const updated = await this.prisma.tag.update({
      where: { id },
      data,
      select: TAG_SELECT,
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
    await this.prisma.tag.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
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
