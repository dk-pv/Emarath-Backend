import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLeadSourceDto,
  LeadSourceNode,
  UpdateLeadSourceDto,
} from './dto/lead-source.dto';

const LEAD_SOURCE_SELECT = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.LeadSourceSelect;

type LeadSourceRow = Prisma.LeadSourceGetPayload<{
  select: typeof LEAD_SOURCE_SELECT;
}>;

/**
 * The lead source catalogue behind Settings → Sales & CRM Configuration → Lead Source.
 *
 * The same contract `CategoriesService` and `StagesService` hold: a source's `name` is the
 * value a lead stores in `Lead.source`, so a rename cascades to those leads in one
 * transaction and a delete is refused while any lead still carries the name. Neither the
 * list, the filters nor a report can end up pointing at a source that no longer exists,
 * and deleting a source can never delete a lead.
 */
@Injectable()
export class LeadSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The catalogue in name order — the order the reference table lists. */
  async list(): Promise<LeadSourceNode[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.leadSource.findMany({
        select: LEAD_SOURCE_SELECT,
        orderBy: { name: 'asc' },
      }),
      this.leadCounts(),
    ]);
    return rows.map((row) => this.toNode(row, counts));
  }

  /**
   * Adds a source, attributed to the caller.
   *
   * `createdById` comes from the authenticated identity and is never accepted from the
   * request body, so one user cannot file a source under another's name.
   */
  async create(dto: CreateLeadSourceDto): Promise<LeadSourceNode> {
    const actor = await this.currentUser.resolve();
    const name = dto.name.trim();
    await this.assertNameFree(name);

    const created = await this.prisma.leadSource.create({
      data: {
        name,
        isActive: dto.isActive ?? true,
        createdById: actor.id,
      },
      select: { id: true },
    });
    return this.requireNode(created.id);
  }

  /**
   * Renames and/or activates a source.
   *
   * A rename and its lead cascade succeed or fail together: a source's name and the leads
   * pointing at it must never end up out of step. `createdById` and `createdAt` are not
   * writable here, so editing never rewrites who added the source or when.
   */
  async update(id: string, dto: UpdateLeadSourceDto): Promise<LeadSourceNode> {
    const source = await this.requireRow(id);

    const data: Prisma.LeadSourceUpdateInput = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const newName = dto.name?.trim();
    if (newName !== undefined && newName !== source.name) {
      await this.assertNameFree(newName, id);
      await this.prisma.$transaction([
        this.prisma.leadSource.update({
          where: { id },
          data: { ...data, name: newName },
          select: { id: true },
        }),
        this.prisma.lead.updateMany({
          where: { source: source.name },
          data: { source: newName },
        }),
      ]);
      return this.requireNode(id);
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.leadSource.update({
        where: { id },
        data,
        select: { id: true },
      });
    }
    return this.requireNode(id);
  }

  /**
   * Removes a source, but only when no lead carries it.
   *
   * Leads are never touched: clearing `Lead.source` would silently rewrite business data
   * and cascading would destroy the leads themselves, so the refusal names the count and
   * the user decides. Deactivating is the way to retire a source that is in use — it stays
   * on its historical leads and stops being offered for new ones.
   */
  async remove(id: string): Promise<{ id: string }> {
    const source = await this.requireRow(id);

    const inUse = await this.prisma.lead.count({
      where: { source: source.name, deletedAt: null },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `This lead source is used by ${inUse} lead${inUse === 1 ? '' : 's'}. Reassign them, or deactivate the source instead of deleting it.`,
      );
    }

    await this.prisma.leadSource.delete({ where: { id } });
    return { id };
  }

  // ---------- internals ----------

  /** Live leads per source name, in one grouped query rather than one per row. */
  private async leadCounts(): Promise<Map<string, number>> {
    const grouped = await this.prisma.lead.groupBy({
      by: ['source'],
      where: { deletedAt: null, source: { not: null } },
      _count: { _all: true },
    });
    return new Map(
      grouped
        .filter(
          (row): row is typeof row & { source: string } => row.source !== null,
        )
        .map((row) => [row.source, row._count._all]),
    );
  }

  private async requireRow(id: string) {
    const found = await this.prisma.leadSource.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!found) throw new NotFoundException('Lead source not found.');
    return found;
  }

  private async requireNode(id: string): Promise<LeadSourceNode> {
    const node = (await this.list()).find((row) => row.id === id);
    if (!node) throw new NotFoundException('Lead source not found.');
    return node;
  }

  /**
   * Names identify a source to every lead, so a clash is refused rather than allowed to
   * make two rows indistinguishable. Case-insensitive, as the rest of the catalogues are:
   * "Website" and "WEBSITE" would read as the same source to a person looking at the list.
   */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.leadSource.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `A lead source named “${name.trim()}” already exists.`,
      );
    }
  }

  private toNode(
    row: LeadSourceRow,
    counts: Map<string, number>,
  ): LeadSourceNode {
    return {
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      leadCount: counts.get(row.name) ?? 0,
      createdByName: row.createdBy?.name ?? null,
      createdAt: row.createdAt,
    };
  }
}
