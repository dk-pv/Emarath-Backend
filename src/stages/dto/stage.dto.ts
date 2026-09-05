import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DEFAULT_PIPELINE,
  MAX_STAGE_PROBABILITY,
  MIN_STAGE_PROBABILITY,
  STAGE_COLORS,
  STAGE_INCLUSIONS,
  STAGE_OUTCOMES,
} from '../stage.constants';
import type { StageInclusion, StageOutcome } from '../stage.constants';

/**
 * The Sales Pipeline wizard's stage fields, shared by create and update (ADR-0060).
 *
 * Every one is optional: the Kanban board's add/rename/recolour calls send none of them
 * and must keep working exactly as before, so an omitted field leaves the column at its
 * default (create) or untouched (update).
 */
export class StageWizardFieldsDto {
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  /** Null clears it — an open stage has no outcome. */
  @IsOptional()
  @IsIn([...STAGE_OUTCOMES], {
    message: 'outcome must be WON, LOST or IGNORE',
  })
  outcome?: StageOutcome | null;

  @IsOptional()
  @IsIn([...STAGE_INCLUSIONS])
  inclusion?: StageInclusion;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_STAGE_PROBABILITY)
  @Max(MAX_STAGE_PROBABILITY)
  probability?: number;

  @IsOptional()
  @IsBoolean()
  requireFollowUp?: boolean;
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimOrDefaultPipeline = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_PIPELINE;

/** Which pipeline's stages to read (KAN-05.1) — defaults to the sales board. */
export class StageListQueryDto {
  @Transform(trimOrDefaultPipeline)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  pipeline: string = DEFAULT_PIPELINE;
}

/** Add a stage to a pipeline (KAN-05.1 AC1). Appended after the last stage. */
export class CreateStageDto extends StageWizardFieldsDto {
  @Transform(trimOrDefaultPipeline)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  pipeline: string = DEFAULT_PIPELINE;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(64)
  name!: string;

  @Transform(trim)
  @IsIn([...STAGE_COLORS], { message: 'color must be a known palette key' })
  color!: string;
}

/**
 * Rename and/or recolour a stage (KAN-05.1 AC2). Both optional — a caller may change
 * either. A blank name is rejected (AC5); a rename cascades to the leads in the stage.
 */
export class UpdateStageDto extends StageWizardFieldsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  @MaxLength(64)
  @IsOptional()
  name?: string;

  @Transform(trim)
  @IsIn([...STAGE_COLORS], { message: 'color must be a known palette key' })
  @IsOptional()
  color?: string;
}

/** Reorder a pipeline's stages (KAN-05.1 AC3) — the new order, as every stage id once. */
export class ReorderStagesDto {
  @Transform(trimOrDefaultPipeline)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  pipeline: string = DEFAULT_PIPELINE;

  @IsArray()
  @ArrayNotEmpty({ message: 'orderedIds must not be empty' })
  @IsUUID('all', { each: true, message: 'each id must be a valid stage id' })
  orderedIds!: string[];
}

/** One stage as the API returns it. */
export interface StageResponse {
  id: string;
  pipeline: string;
  name: string;
  color: string;
  position: number;
  isClosed: boolean;
  outcome: string | null;
  inclusion: string;
  probability: number;
  requireFollowUp: boolean;
}
