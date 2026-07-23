import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStageDto,
  ReorderStagesDto,
  StageResponse,
  UpdateStageDto,
} from './dto/stage.dto';

const STAGE_SELECT = {
  id: true,
  pipeline: true,
  name: true,
  color: true,
  position: true,
} satisfies Prisma.StageSelect;

/**
 * The pipeline stage catalogue (KAN-05.1) — the one place stages are added, renamed,
 * recoloured, reordered and deleted, and the source the board, list badges, status
 * dropdown, filters and reports read from.
 *
 * A stage's `name` is the value a lead stores in `status`, so a rename cascades to the
 * leads carrying the old status (in one transaction), keeping "status = stage" true and
 * the change visible on the list and reports (AC4). A delete is guarded — refused while
 * leads still sit in the stage — so the catalogue can never orphan a lead's status.
 */
@Injectable()
export class StagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** A pipeline's stages in display order (AC3/AC4). */
  list(pipeline: string): Promise<StageResponse[]> {
    return this.prisma.stage.findMany({
      where: { pipeline },
      select: STAGE_SELECT,
      orderBy: { position: 'asc' },
    });
  }

  /**
   * Whether `name` is a stage of `pipeline` — the canonical membership check the board's
   * drag-move validates against (KAN-04.1 AC4), replacing the old hard-coded list.
   */
  async exists(pipeline: string, name: string): Promise<boolean> {
    const found = await this.prisma.stage.findUnique({
      where: { pipeline_name: { pipeline, name } },
      select: { id: true },
    });
    return found !== null;
  }

  /** Adds a stage, appended after the current last one (AC1). */
  async create(dto: CreateStageDto): Promise<StageResponse> {
    const { pipeline, name, color } = dto;

    const clash = await this.prisma.stage.findUnique({
      where: { pipeline_name: { pipeline, name } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`A stage named “${name}” already exists.`);
    }

    // Order is owned by the reorder endpoint; a new stage lands at the end.
    const last = await this.prisma.stage.findFirst({
      where: { pipeline },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.stage.create({
      data: { pipeline, name, color, position: last ? last.position + 1 : 0 },
      select: STAGE_SELECT,
    });
  }

  /** Renames and/or recolours a stage (AC2); a rename cascades to its leads. */
  async update(id: string, dto: UpdateStageDto): Promise<StageResponse> {
    const stage = await this.prisma.stage.findUnique({
      where: { id },
      select: { id: true, pipeline: true, name: true },
    });
    if (!stage) throw new NotFoundException('Stage not found.');

    const data: Prisma.StageUpdateInput = {};
    if (dto.color !== undefined) data.color = dto.color;

    const newName = dto.name;
    if (newName !== undefined && newName !== stage.name) {
      const nameClash = await this.prisma.stage.findUnique({
        where: { pipeline_name: { pipeline: stage.pipeline, name: newName } },
        select: { id: true },
      });
      if (nameClash) {
        throw new ConflictException(
          `A stage named “${newName}” already exists.`,
        );
      }
      // The rename and the lead cascade succeed or fail together — a stage name and
      // the statuses that point at it must never end up out of step.
      const [updated] = await this.prisma.$transaction([
        this.prisma.stage.update({
          where: { id },
          data: { ...data, name: newName },
          select: STAGE_SELECT,
        }),
        this.prisma.lead.updateMany({
          where: { status: stage.name, pipeline: stage.pipeline },
          data: { status: newName },
        }),
      ]);
      return updated;
    }

    return this.prisma.stage.update({
      where: { id },
      data,
      select: STAGE_SELECT,
    });
  }

  /** Persists a new stage order for a pipeline (AC3). */
  async reorder(dto: ReorderStagesDto): Promise<StageResponse[]> {
    const { pipeline, orderedIds } = dto;

    const stages = await this.prisma.stage.findMany({
      where: { pipeline },
      select: { id: true },
    });

    // The new order must be exactly the pipeline's stages, each listed once — anything
    // else would drop a stage or reorder one that isn't on this board (invalid state).
    const known = new Set(stages.map((s) => s.id));
    const given = new Set(orderedIds);
    const sameSet =
      known.size === given.size &&
      given.size === orderedIds.length &&
      [...given].every((eachId) => known.has(eachId));
    if (!sameSet) {
      throw new BadRequestException(
        'orderedIds must list every stage in the pipeline exactly once.',
      );
    }

    await this.prisma.$transaction(
      orderedIds.map((eachId, position) =>
        this.prisma.stage.update({ where: { id: eachId }, data: { position } }),
      ),
    );

    return this.list(pipeline);
  }

  /** Deletes a stage, refused while leads still sit in it (AC5, prevents orphans). */
  async remove(id: string): Promise<{ id: string }> {
    const stage = await this.prisma.stage.findUnique({
      where: { id },
      select: { id: true, pipeline: true, name: true },
    });
    if (!stage) throw new NotFoundException('Stage not found.');

    const inUse = await this.prisma.lead.count({
      where: { status: stage.name, pipeline: stage.pipeline, deletedAt: null },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `This stage holds ${inUse} lead(s); move them before deleting it.`,
      );
    }

    await this.prisma.stage.delete({ where: { id } });
    return { id };
  }
}
