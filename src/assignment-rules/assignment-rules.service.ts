import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignmentRuleGroupDto,
  AssignmentRuleList,
  AssignmentRuleRow,
  CreateAssignmentRuleDto,
  DEFAULT_RULE_PAGE_SIZE,
  ListAssignmentRulesQueryDto,
  UpdateAssignmentRuleDto,
} from './dto/assignment-rule.dto';

const SELECT = {
  id: true,
  name: true,
  description: true,
  algorithm: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  groups: {
    select: {
      id: true,
      name: true,
      position: true,
      applyTo: true,
      target: true,
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.AssignmentRuleSelect;

type Selected = Prisma.AssignmentRuleGetPayload<{ select: typeof SELECT }>;

function toRow(row: Selected): AssignmentRuleRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    algorithm: row.algorithm,
    status: row.status,
    createdByName: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    groups: row.groups.map((group) => ({
      id: group.id,
      name: group.name,
      position: group.position,
      applyTo: group.applyTo,
      target: group.target,
    })),
  };
}

/** The array's index is the group's position, so the sent order is the stored order. */
const toGroupRows = (groups: AssignmentRuleGroupDto[]) =>
  groups.map((group, index) => ({
    name: group.name,
    position: index,
    applyTo: group.applyTo,
    target: group.target,
  }));

/**
 * Settings → Assignment → Assignment Rules.
 *
 * Search, the status filter and paging are resolved in the query, never in the client, and
 * the count is taken against the same predicate the page is read with so the footer can
 * never disagree with the rows above it.
 *
 * A rule and its groups are written together in a transaction: the reference's wizard
 * cannot produce a rule without groups, so neither can this — a half-written rule would be
 * a rule the assignment engine could pick up and find nothing to do with.
 *
 * Deletes are soft (CLAUDE.md §11); every query names `deletedAt` explicitly because no
 * automatic filter exists yet.
 */
@Injectable()
export class AssignmentRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAssignmentRulesQueryDto): Promise<AssignmentRuleList> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_RULE_PAGE_SIZE;

    const where: Prisma.AssignmentRuleWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.assignmentRule.findMany({
        where,
        select: SELECT,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.assignmentRule.count({ where }),
    ]);

    return { rows: rows.map(toRow), total };
  }

  async byId(id: string): Promise<AssignmentRuleRow> {
    const row = await this.prisma.assignmentRule.findFirst({
      where: { id, deletedAt: null },
      select: SELECT,
    });
    if (!row) throw new NotFoundException('That rule no longer exists.');
    return toRow(row);
  }

  async create(
    dto: CreateAssignmentRuleDto,
    actorId: string,
  ): Promise<AssignmentRuleRow> {
    await this.assertNameFree(dto.name, null);

    const created = await this.prisma.assignmentRule.create({
      data: {
        name: dto.name,
        description: dto.description,
        algorithm: dto.algorithm,
        status: dto.status,
        createdById: actorId,
        groups: { create: toGroupRows(dto.groups) },
      },
      select: SELECT,
    });
    return toRow(created);
  }

  /**
   * Edits the rule in place. Groups, when sent, replace the whole list in one transaction:
   * the wizard hands back the finished set rather than a diff, and rewriting the list is
   * the only way a reorder, a rename and a deletion can land together without a moment
   * where two groups hold the same position.
   */
  async update(
    id: string,
    dto: UpdateAssignmentRuleDto,
  ): Promise<AssignmentRuleRow> {
    await this.requireLive(id);
    if (dto.name !== undefined) await this.assertNameFree(dto.name, id);

    const groups = dto.groups;

    await this.prisma.$transaction(async (tx) => {
      if (groups) {
        await tx.assignmentRuleGroup.deleteMany({ where: { ruleId: id } });
      }
      await tx.assignmentRule.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.description === undefined
            ? {}
            : { description: dto.description }),
          ...(dto.algorithm === undefined ? {} : { algorithm: dto.algorithm }),
          ...(dto.status === undefined ? {} : { status: dto.status }),
          ...(groups ? { groups: { create: toGroupRows(groups) } } : {}),
        },
        select: { id: true },
      });
    });

    return this.byId(id);
  }

  /** Soft delete: the rule leaves every list and the engine, and the record remains. */
  async remove(id: string): Promise<{ id: string }> {
    await this.requireLive(id);

    await this.prisma.assignmentRule.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
    return { id };
  }

  /**
   * Two rules sharing a name are indistinguishable in the list and in any report of what
   * assigned a lead, so a duplicate is refused rather than quietly accepted.
   */
  private async assertNameFree(name: string, exceptId: string | null) {
    const clash = await this.prisma.assignmentRule.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(`A rule named “${name}” already exists.`);
  }

  private async requireLive(id: string): Promise<void> {
    const existing = await this.prisma.assignmentRule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('That rule no longer exists.');
  }
}
