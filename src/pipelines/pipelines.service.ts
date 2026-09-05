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
  CreatePipelineDto,
  PipelinePermissionDto,
  PipelineNode,
  PipelineSettingsDto,
  TEMPLATE_STAGES,
  UpdatePipelineDto,
} from './dto/pipeline.dto';
import type {
  ExpiryScope,
  PipelineAccessMode,
  PermissionType,
  PipelineTemplate,
} from './dto/pipeline.dto';

const PIPELINE_SELECT = {
  id: true,
  name: true,
  shortCode: true,
  isDefault: true,
  createdAt: true,
  accessMode: true,
  templateKey: true,
  defaultStageId: true,
  mandatoryValueStageId: true,
  qualifiedStageId: true,
  autoConvertAtWon: true,
  expiryEnabled: true,
  expiryScope: true,
  expiryDays: true,
  expiredStageId: true,
  reassignedStageId: true,
  reassignExpiredToId: true,
  createdBy: { select: { name: true } },
  permissions: {
    select: {
      id: true,
      permissionType: true,
      roleId: true,
      userId: true,
      role: { select: { name: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PipelineSelect;

type PipelineRow = Prisma.PipelineGetPayload<{
  select: typeof PIPELINE_SELECT;
}>;

/**
 * The sales pipeline catalogue behind Settings → Sales & CRM Configuration → Sales Pipeline.
 *
 * A pipeline's `name` is the value stored in `Lead.pipeline`, `Stage.pipeline` and
 * `User.pipelines[]` (ADR-0059), so this service holds the same contract `StagesService`
 * holds for stages: a rename cascades to all three in one transaction, and a delete is
 * refused while any live lead still sits on the pipeline. Nothing here can orphan a lead,
 * a stage or a team member's pipeline access.
 */
@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The catalogue, default first then oldest first — the reference list's order. */
  async list(): Promise<PipelineNode[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.pipeline.findMany({
        select: PIPELINE_SELECT,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      this.leadCounts(),
    ]);
    return rows.map((row) => this.toNode(row, counts));
  }

  /** Adds a pipeline. The very first one becomes the default, so one always exists. */
  async create(dto: CreatePipelineDto): Promise<PipelineNode> {
    const actor = await this.currentUser.resolve();
    await this.assertNameFree(dto.name);
    await this.assertShortCodeFree(dto.shortCode);

    const accessMode = dto.accessMode ?? 'ALL_USERS';
    const grants = this.grantRows(accessMode, dto.permissions);

    const existing = await this.prisma.pipeline.count();
    const created = await this.prisma.pipeline.create({
      data: {
        name: dto.name.trim(),
        shortCode: dto.shortCode,
        isDefault: existing === 0,
        createdById: actor.id,
        accessMode,
        templateKey: dto.templateKey ?? null,
        permissions: grants.length > 0 ? { create: grants } : undefined,
      },
      select: { id: true, name: true },
    });

    // Cloning copies the template's stages into the new pipeline. Every template's set is
    // empty until the reference shows what they contain (ADR-0060), so today this adds
    // nothing — the choice is still recorded on the pipeline, and filling the map in later
    // needs no change here.
    if (dto.templateKey) {
      await this.cloneTemplate(created.name, dto.templateKey);
    }

    return this.requireNode(created.id);
  }

  /**
   * Renames and/or re-codes a pipeline.
   *
   * The rename and every cascade succeed or fail together: a pipeline's name and the leads,
   * stages and member grants pointing at it must never end up out of step. `User.pipelines`
   * is a string array, so its rows are rewritten individually — a bounded set, and the only
   * way to replace one element of a Postgres array through Prisma.
   */
  async update(id: string, dto: UpdatePipelineDto): Promise<PipelineNode> {
    const pipeline = await this.requireRow(id);

    if (dto.shortCode !== undefined && dto.shortCode !== pipeline.shortCode) {
      await this.assertShortCodeFree(dto.shortCode, id);
    }

    // Step 3's block, validated against the pipeline it is being written to. Absent when
    // step 1 saves, in which case every stored setting is left exactly as it was.
    const settings = dto.settings
      ? await this.settingsData(pipeline.name, dto.settings)
      : undefined;

    const newName = dto.name?.trim();
    if (newName !== undefined && newName !== pipeline.name) {
      await this.assertNameFree(newName, id);

      const holders = await this.prisma.user.findMany({
        where: { pipelines: { has: pipeline.name } },
        select: { id: true, pipelines: true },
      });

      await this.prisma.$transaction([
        this.prisma.pipeline.update({
          where: { id },
          data: {
            name: newName,
            ...(dto.shortCode !== undefined
              ? { shortCode: dto.shortCode }
              : {}),
            ...settings,
          },
          select: { id: true },
        }),
        this.prisma.lead.updateMany({
          where: { pipeline: pipeline.name },
          data: { pipeline: newName },
        }),
        this.prisma.stage.updateMany({
          where: { pipeline: pipeline.name },
          data: { pipeline: newName },
        }),
        ...holders.map((holder) =>
          this.prisma.user.update({
            where: { id: holder.id },
            data: {
              pipelines: holder.pipelines.map((each) =>
                each === pipeline.name ? newName : each,
              ),
            },
            select: { id: true },
          }),
        ),
      ]);

      return this.requireNode(id);
    }

    const rest: Prisma.PipelineUncheckedUpdateInput = { ...settings };
    if (dto.shortCode !== undefined) rest.shortCode = dto.shortCode;
    if (dto.accessMode !== undefined) rest.accessMode = dto.accessMode;

    // A permissions array replaces the whole list; omitting it leaves the grants alone.
    if (dto.permissions !== undefined || dto.accessMode !== undefined) {
      const accessMode =
        dto.accessMode ??
        ((await this.requireRow(id)).accessMode as PipelineAccessMode);
      const grants = this.grantRows(accessMode, dto.permissions);
      rest.permissions = {
        deleteMany: {},
        ...(grants.length > 0 ? { create: grants } : {}),
      };
    }

    if (Object.keys(rest).length > 0) {
      await this.prisma.pipeline.update({
        where: { id },
        data: rest,
        select: { id: true },
      });
    }
    return this.requireNode(id);
  }

  /**
   * Wizard step 3's stored columns, with every rule the frontend must not be trusted to
   * have applied.
   *
   * The step submits its complete state, so this replaces the whole block rather than
   * merging: a field the user cleared has to come back cleared. The expiry values are
   * written even when `expiryEnabled` is false — that is what lets the toggle be switched
   * off and back on without losing the configuration underneath it.
   */
  private async settingsData(
    pipelineName: string,
    dto: PipelineSettingsDto,
  ): Promise<{
    defaultStageId: string;
    mandatoryValueStageId: string | null;
    qualifiedStageId: string | null;
    autoConvertAtWon: boolean;
    expiryEnabled: boolean;
    expiryScope: ExpiryScope | null;
    expiryDays: number | null;
    expiredStageId: string | null;
    reassignedStageId: string | null;
    reassignExpiredToId: string | null;
  }> {
    const expiryEnabled = dto.expiryEnabled ?? false;

    // Only the four the reference marks with an asterisk; "Reassign Expired Leads To"
    // carries none, so an expiry rule may legitimately leave the lead with its owner.
    if (expiryEnabled) {
      const missing: string[] = [];
      if (!dto.expiryScope) missing.push('Set Expiry For');
      if (dto.expiryDays == null) missing.push('Expire After (Days)');
      if (!dto.expiredStageId) missing.push('Status When Leads Expired');
      if (!dto.reassignedStageId)
        missing.push('Status When Reassigned to user');
      if (missing.length > 0) {
        throw new BadRequestException(
          `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required while lead expiry is on.`,
        );
      }
    }

    await this.assertStagesBelong(pipelineName, [
      dto.defaultStageId,
      dto.mandatoryValueStageId,
      dto.qualifiedStageId,
      dto.expiredStageId,
      dto.reassignedStageId,
    ]);

    if (dto.reassignExpiredToId) {
      const target = await this.prisma.user.findFirst({
        where: { id: dto.reassignExpiredToId, deletedAt: null },
        select: { id: true },
      });
      if (!target) {
        throw new BadRequestException(
          'Choose a current team member to reassign expired leads to.',
        );
      }
    }

    return {
      defaultStageId: dto.defaultStageId,
      mandatoryValueStageId: dto.mandatoryValueStageId ?? null,
      qualifiedStageId: dto.qualifiedStageId ?? null,
      autoConvertAtWon: dto.autoConvertAtWon ?? false,
      expiryEnabled,
      expiryScope: dto.expiryScope ?? null,
      expiryDays: dto.expiryDays ?? null,
      expiredStageId: dto.expiredStageId ?? null,
      reassignedStageId: dto.reassignedStageId ?? null,
      reassignExpiredToId: dto.reassignExpiredToId ?? null,
    };
  }

  /**
   * Every id given must be a stage of this pipeline.
   *
   * A stage from another pipeline would be a setting no lead on this board could ever
   * reach, so it is refused rather than stored — the foreign key alone would accept it.
   */
  private async assertStagesBelong(
    pipelineName: string,
    ids: (string | null | undefined)[],
  ): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return;

    const found = await this.prisma.stage.findMany({
      where: { id: { in: wanted } },
      select: { id: true, pipeline: true },
    });
    const mine = new Set(
      found.filter((row) => row.pipeline === pipelineName).map((row) => row.id),
    );
    if (wanted.some((id) => !mine.has(id))) {
      throw new BadRequestException(
        'Every stage setting must name a stage of this pipeline.',
      );
    }
  }

  /** Copies a template's stages into a freshly created pipeline, in listed order. */
  private async cloneTemplate(
    pipeline: string,
    template: PipelineTemplate,
  ): Promise<void> {
    const stages = TEMPLATE_STAGES[template];
    if (stages.length === 0) return;

    await this.prisma.stage.createMany({
      data: stages.map((stage, position) => ({
        pipeline,
        name: stage.name,
        color: stage.color,
        isClosed: stage.isClosed,
        position,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * The grant rows a pipeline should hold.
   *
   * `ALL_USERS` means "everyone", so it carries no rows at all — keeping stale grants
   * behind an all-users pipeline would leave a list that reads as active but is not.
   * Each row must name exactly the target its type implies.
   */
  private grantRows(
    accessMode: PipelineAccessMode,
    permissions: PipelinePermissionDto[] | undefined,
  ): {
    permissionType: PermissionType;
    roleId: string | null;
    userId: string | null;
  }[] {
    if (accessMode !== 'SPECIFIC') return [];

    return (permissions ?? []).map((row) => {
      if (row.permissionType === 'ROLE' && !row.roleId) {
        throw new BadRequestException(
          'Choose a role for every role permission.',
        );
      }
      if (row.permissionType === 'USER' && !row.userId) {
        throw new BadRequestException(
          'Choose a user for every user permission.',
        );
      }
      return {
        permissionType: row.permissionType,
        roleId: row.permissionType === 'ROLE' ? (row.roleId ?? null) : null,
        userId: row.permissionType === 'USER' ? (row.userId ?? null) : null,
      };
    });
  }

  /**
   * Makes one pipeline the default, clearing the previous one in the same transaction so
   * the catalogue can never hold two defaults — or, between two writes, none.
   */
  async setDefault(id: string): Promise<PipelineNode[]> {
    await this.requireRow(id);

    await this.prisma.$transaction([
      this.prisma.pipeline.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      }),
      this.prisma.pipeline.update({
        where: { id },
        data: { isDefault: true },
        select: { id: true },
      }),
    ]);

    return this.list();
  }

  /**
   * Removes a pipeline, but only when nothing depends on it.
   *
   * Live leads block it — clearing or reassigning `Lead.pipeline` would silently rewrite
   * business data. The default blocks it too, because something must always be the default.
   * Its stages go with it: a stage cannot exist without its pipeline, and since no lead is
   * on the pipeline, no lead is in any of its stages either, so nothing is orphaned.
   */
  async remove(id: string): Promise<{ id: string }> {
    const pipeline = await this.requireRow(id);

    if (pipeline.isDefault) {
      throw new ConflictException(
        'This is the default pipeline. Make another pipeline the default before deleting it.',
      );
    }

    const inUse = await this.prisma.lead.count({
      where: { pipeline: pipeline.name, deletedAt: null },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `This pipeline holds ${inUse} lead${inUse === 1 ? '' : 's'}. Move them before deleting it.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.stage.deleteMany({ where: { pipeline: pipeline.name } }),
      this.prisma.pipeline.delete({ where: { id } }),
    ]);
    return { id };
  }

  // ---------- internals ----------

  /** Live leads per pipeline name, in one grouped query rather than one per row. */
  private async leadCounts(): Promise<Map<string, number>> {
    const grouped = await this.prisma.lead.groupBy({
      by: ['pipeline'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.pipeline, row._count._all]));
  }

  private async requireRow(id: string) {
    const found = await this.prisma.pipeline.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        shortCode: true,
        isDefault: true,
        accessMode: true,
      },
    });
    if (!found) throw new NotFoundException('Pipeline not found.');
    return found;
  }

  private async requireNode(id: string): Promise<PipelineNode> {
    const node = (await this.list()).find((row) => row.id === id);
    if (!node) throw new NotFoundException('Pipeline not found.');
    return node;
  }

  /**
   * Names identify a pipeline to every lead, stage and member grant, so a clash is refused
   * rather than allowed to make two rows indistinguishable. Case-insensitive: "LOGISTICS"
   * and "Logistics" would read as the same pipeline to a person looking at the list.
   */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.pipeline.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `A pipeline named “${name.trim()}” already exists.`,
      );
    }
  }

  private async assertShortCodeFree(
    shortCode: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.pipeline.findFirst({
      where: {
        shortCode: { equals: shortCode, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `The short code “${shortCode}” is already used by another pipeline.`,
      );
    }
  }

  private toNode(row: PipelineRow, counts: Map<string, number>): PipelineNode {
    return {
      id: row.id,
      name: row.name,
      shortCode: row.shortCode,
      isDefault: row.isDefault,
      leadCount: counts.get(row.name) ?? 0,
      createdByName: row.createdBy?.name ?? null,
      createdAt: row.createdAt,
      accessMode: row.accessMode as PipelineAccessMode,
      templateKey: row.templateKey,
      permissions: row.permissions.map((grant) => ({
        id: grant.id,
        permissionType: grant.permissionType as PermissionType,
        roleId: grant.roleId,
        userId: grant.userId,
        label: grant.role?.name ?? grant.user?.name ?? null,
      })),
      settings: {
        defaultStageId: row.defaultStageId,
        mandatoryValueStageId: row.mandatoryValueStageId,
        qualifiedStageId: row.qualifiedStageId,
        autoConvertAtWon: row.autoConvertAtWon,
        expiryEnabled: row.expiryEnabled,
        expiryScope: row.expiryScope as ExpiryScope | null,
        expiryDays: row.expiryDays,
        expiredStageId: row.expiredStageId,
        reassignedStageId: row.reassignedStageId,
        reassignExpiredToId: row.reassignExpiredToId,
      },
    };
  }
}
