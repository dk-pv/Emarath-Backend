import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user';
import {
  AuditState,
  RENAME,
  recordAuditEvents,
  recordStateChange,
  userActor,
} from '../audit/audit-events';
import { assertPipelineOpen } from '../pipelines/pipeline-access';
import { CONVERTED_STATUS } from '../reports/converted-leads-where';
import { QC_REJECTED_LEAD_STATUS } from '../logistics/logistics-status';
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
  isClosed: true,
  outcome: true,
  inclusion: true,
  probability: true,
  requireFollowUp: true,
} satisfies Prisma.StageSelect;

type StageRow = Prisma.StageGetPayload<{ select: typeof STAGE_SELECT }>;

/** A stage as its audit events describe it (AUD-03); each event names the pipeline in metadata. */
function stageState(row: StageRow): AuditState {
  return {
    name: row.name,
    color: row.color,
    position: row.position,
    isClosed: row.isClosed,
    outcome: row.outcome,
    inclusion: row.inclusion,
    probability: row.probability,
    requireFollowUp: row.requireFollowUp,
  };
}

/**
 * The Sales Pipeline wizard's fields, taken off a DTO only where the caller sent them
 * (ADR-0060). The Kanban board sends none, so its create/update calls behave exactly as
 * before: omitted keys never reach the write, leaving the column at its default or
 * untouched. `outcome` is the exception — null is meaningful there, so it is forwarded.
 */
type StageWizardData = {
  isClosed?: boolean;
  outcome?: string | null;
  inclusion?: string;
  probability?: number;
  requireFollowUp?: boolean;
};

function wizardFields(dto: StageWizardData): StageWizardData {
  const data: StageWizardData = {};
  if (dto.isClosed !== undefined) data.isClosed = dto.isClosed;
  if (dto.outcome !== undefined) data.outcome = dto.outcome;
  if (dto.inclusion !== undefined) data.inclusion = dto.inclusion;
  if (dto.probability !== undefined) data.probability = dto.probability;
  if (dto.requireFollowUp !== undefined) {
    data.requireFollowUp = dto.requireFollowUp;
  }
  return data;
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

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

  /**
   * Refuses managing the stages of a pipeline closed to the caller (ADR-0093 B10). The route's
   * @Roles still decides who manages stages at all; this decides where.
   */
  private async assertMayManage(pipeline: string): Promise<void> {
    assertPipelineOpen(await this.currentUser.resolve(), pipeline);
  }

  /** Adds a stage, appended after the current last one (AC1). */
  async create(dto: CreateStageDto): Promise<StageResponse> {
    const { pipeline, name, color } = dto;
    await this.assertMayManage(pipeline);

    // A second WON / QC NOT APPROVED would convert or QC-reject leads by name in
    // whichever pipeline holds it, and could then never be renamed or deleted
    // (ADR-0085 B17), so the reserved names are refused on create too.
    if (RESERVED_STAGE_NAMES.includes(name)) {
      throw new ConflictException(
        `“${name}” is reserved for the Logistics workflow.`,
      );
    }

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

    const actor = userActor(await this.currentUser.resolve());
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.stage.create({
        data: {
          pipeline,
          name,
          color,
          position: last ? last.position + 1 : 0,
          ...wizardFields(dto),
        },
        select: STAGE_SELECT,
      });
      await recordAuditEvents(tx, [
        {
          entityType: 'STAGE',
          entityId: row.id,
          leadId: null,
          action: 'CREATED',
          actor,
          source: 'stages.create',
          after: stageState(row),
          metadata: { pipeline },
        },
      ]);
      return row;
    });
  }

  /**
   * Renames, recolours and/or reconfigures a stage (AC2); a rename cascades to its leads.
   *
   * The change, a rename's lead cascade and its events commit together, read and compared under
   * a lock on the stage. A rename relabels leads without moving any of them, so it is recorded
   * once, on the stage (ADR-0083) — no lead gets a STATUS_CHANGED event. Any other field that
   * changed is one UPDATED; a save that changes nothing records nothing (AUD-03).
   */
  async update(id: string, dto: UpdateStageDto): Promise<StageResponse> {
    const stage = await this.prisma.stage.findUnique({
      where: { id },
      select: { id: true, pipeline: true, name: true },
    });
    if (!stage) throw new NotFoundException('Stage not found.');
    await this.assertMayManage(stage.pipeline);

    const data: Prisma.StageUpdateInput = { ...wizardFields(dto) };
    if (dto.color !== undefined) data.color = dto.color;

    const newName = dto.name;
    const renaming = newName !== undefined && newName !== stage.name;
    if (renaming) {
      guardReservedStageName(stage.name, newName);
      const nameClash = await this.prisma.stage.findUnique({
        where: { pipeline_name: { pipeline: stage.pipeline, name: newName } },
        select: { id: true },
      });
      if (nameClash) {
        throw new ConflictException(
          `A stage named “${newName}” already exists.`,
        );
      }
      data.name = newName;
    }

    // The rename and the lead cascade succeed or fail together — a stage name and the
    // statuses that point at it must never end up out of step.
    const actor = userActor(await this.currentUser.resolve());
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stages WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.stage.findUniqueOrThrow({
        where: { id },
        select: STAGE_SELECT,
      });
      const updated = await tx.stage.update({
        where: { id },
        data,
        select: STAGE_SELECT,
      });
      if (renaming) {
        await tx.lead.updateMany({
          where: { status: before.name, pipeline: before.pipeline },
          data: { status: newName },
        });
      }
      await recordStateChange(
        tx,
        {
          entityType: 'STAGE',
          entityId: id,
          leadId: null,
          actor,
          source: 'stages.update',
          metadata: { pipeline: before.pipeline },
        },
        stageState(before),
        stageState(updated),
        [RENAME],
      );
      return updated;
    });
  }

  /**
   * Persists a new stage order for a pipeline (AC3). The order belongs to the pipeline, so it
   * is recorded once, on the pipeline, as its stage names before and after — not as a move per
   * stage whose position shifted; sending the current order records nothing (AUD-03).
   */
  async reorder(dto: ReorderStagesDto): Promise<StageResponse[]> {
    const { pipeline, orderedIds } = dto;
    await this.assertMayManage(pipeline);

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

    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stages WHERE pipeline = ${pipeline} ORDER BY id FOR UPDATE`;
      const current = await tx.stage.findMany({
        where: { pipeline },
        select: { id: true, name: true },
        orderBy: { position: 'asc' },
      });
      for (const [position, eachId] of orderedIds.entries()) {
        await tx.stage.update({ where: { id: eachId }, data: { position } });
      }
      const owner = await tx.pipeline.findUnique({
        where: { name: pipeline },
        select: { id: true },
      });
      if (!owner) return;
      const names = new Map(current.map((each) => [each.id, each.name]));
      await recordStateChange(
        tx,
        {
          entityType: 'PIPELINE',
          entityId: owner.id,
          leadId: null,
          actor,
          source: 'stages.reorder',
        },
        { stageOrder: current.map((each) => each.name) },
        { stageOrder: orderedIds.map((eachId) => names.get(eachId) ?? eachId) },
      );
    });

    return this.list(pipeline);
  }

  /** Deletes a stage, refused while leads still sit in it (AC5, prevents orphans). */
  async remove(id: string): Promise<{ id: string }> {
    const stage = await this.prisma.stage.findUnique({
      where: { id },
      select: { id: true, pipeline: true, name: true },
    });
    if (!stage) throw new NotFoundException('Stage not found.');
    await this.assertMayManage(stage.pipeline);
    guardReservedStageName(stage.name);

    // Archived leads count too: they keep their status, so unarchiving one into a
    // deleted stage would leave it on no board column at all (KAN-05.3 AC5).
    const [inUse, archived] = await Promise.all([
      this.prisma.lead.count({
        where: { status: stage.name, pipeline: stage.pipeline },
      }),
      this.prisma.lead.count({
        where: {
          status: stage.name,
          pipeline: stage.pipeline,
          deletedAt: { not: null },
        },
      }),
    ]);
    if (inUse > 0) {
      const note = archived > 0 ? `, ${archived} of them archived` : '';
      throw new ConflictException(
        `This stage holds ${inUse} lead(s)${note}; move them before deleting it.`,
      );
    }

    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.stage.delete({
        where: { id },
        select: STAGE_SELECT,
      });
      await recordAuditEvents(tx, [
        {
          entityType: 'STAGE',
          entityId: id,
          leadId: null,
          action: 'DELETED',
          actor,
          source: 'stages.delete',
          before: stageState(removed),
          metadata: { pipeline: removed.pipeline },
        },
      ]);
    });
    return { id };
  }
}

/**
 * A pipeline's first stage by position — where a lead lands when it arrives with no
 * status (create, import) or is moved to the pipeline (Change Pipeline). Null when the
 * pipeline has no stages.
 */
export async function firstStageName(
  prisma: PrismaService,
  pipeline: string,
): Promise<string | null> {
  const first = await prisma.stage.findFirst({
    where: { pipeline },
    orderBy: { position: 'asc' },
    select: { name: true },
  });
  return first?.name ?? null;
}

/**
 * The status, once checked: a lead's pipeline must exist and its status must be one of that
 * pipeline's stages — the rule the Kanban move, Change Pipeline and import apply — or the lead
 * sits in no board column. Matched exactly, as the stage catalogue stores it. A pipeline with no
 * stages yet (`status` null, from `firstStageName`) is refused, as import and Change Pipeline
 * refuse it. Shared by create, edit and the status action, so all three answer alike (400).
 */
export async function stageOfPipeline(
  prisma: PrismaService,
  pipeline: string,
  status: string | null,
): Promise<string> {
  const known = await prisma.pipeline.findUnique({
    where: { name: pipeline },
    select: { id: true },
  });
  if (!known) {
    throw new BadRequestException(`Pipeline "${pipeline}" does not exist.`);
  }
  if (status === null) {
    throw new BadRequestException(
      `The "${pipeline}" pipeline has no stages yet. Add its stages in Settings first.`,
    );
  }
  const stage = await prisma.stage.findUnique({
    where: { pipeline_name: { pipeline, name: status } },
    select: { id: true },
  });
  if (!stage) {
    throw new BadRequestException(
      `"${status}" is not a stage of the "${pipeline}" pipeline.`,
    );
  }
  return status;
}

/**
 * The two stage names the Lead → Logistics workflow depends on by value (ADR-0085 B17):
 * `WON` is what conversion is detected on, and `QC NOT APPROVED` is where a QC rejection puts
 * the lead (CD-1, which also says the existing stage must not be renamed).
 *
 * A rename cascades to every lead in the stage through one `updateMany`, outside the per-lead
 * audit and outside the conversion hook — so renaming `WON` away would unconvert a whole
 * column of leads in silence, and renaming another stage *to* `WON` would mark leads converted
 * with no order behind them. Neither is recoverable from the log, so both are refused here,
 * along with deleting either stage. Recolouring, reordering and every other stage stay
 * untouched, and no existing stage or lead is modified by this rule.
 */
export const RESERVED_STAGE_NAMES: readonly string[] = [
  CONVERTED_STATUS,
  QC_REJECTED_LEAD_STATUS,
];

function guardReservedStageName(current: string, next?: string): void {
  const blocked = [current, ...(next === undefined ? [] : [next])].find(
    (name) => RESERVED_STAGE_NAMES.includes(name),
  );
  if (blocked !== undefined) {
    throw new ConflictException(
      `“${blocked}” is used by the Logistics workflow, so it can’t be renamed or deleted.`,
    );
  }
}
