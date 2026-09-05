import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Matches `pipelines.name`, and the `VarChar(64)` the lead/stage columns store it in. */
export const MAX_PIPELINE_NAME = 64;
export const MAX_SHORT_CODE = 16;

/** The wizard's "Choose who can access the pipeline" select. Both options are visible. */
export const PIPELINE_ACCESS_MODES = ['ALL_USERS', 'SPECIFIC'] as const;
export type PipelineAccessMode = (typeof PIPELINE_ACCESS_MODES)[number];

/** The Permission Type select's two options, both visible in the reference. */
export const PERMISSION_TYPES = ['ROLE', 'USER'] as const;
export type PermissionType = (typeof PERMISSION_TYPES)[number];

/**
 * The wizard's fixed template catalogue, exactly the eight names the reference dropdown
 * lists and in its order.
 *
 * What each template contributes is deliberately absent: the screenshots prove the names
 * and nothing else, so `TEMPLATE_STAGES` maps every key to an empty stage set rather than
 * inventing stage definitions (ADR-0060). Filling one in later is a data change here, with
 * no wiring to redo — `clone` already reads this map.
 */
export const PIPELINE_TEMPLATES = [
  'Education',
  'Real Estate',
  'Car Sales',
  'Product',
  'Travel',
  'Software',
  'Automobiles',
  'Stock Broking',
] as const;
export type PipelineTemplate = (typeof PIPELINE_TEMPLATES)[number];

/** One stage a template contributes. Empty for every template until the reference shows them. */
export interface TemplateStage {
  name: string;
  color: string;
  isClosed: boolean;
}

export const TEMPLATE_STAGES: Record<
  PipelineTemplate,
  readonly TemplateStage[]
> = {
  Education: [],
  'Real Estate': [],
  'Car Sales': [],
  Product: [],
  Travel: [],
  Software: [],
  Automobiles: [],
  'Stock Broking': [],
};

/** The wizard's "Set Expiry For" select — exactly the two options the reference lists. */
export const EXPIRY_SCOPES = ['ALL_LEADS', 'INDIVIDUAL_LEADS'] as const;
export type ExpiryScope = (typeof EXPIRY_SCOPES)[number];

export const MIN_EXPIRY_DAYS = 1;
/**
 * The `expiry_days` INTEGER column's own ceiling, not a business rule: the reference
 * shows the field's placeholder and never its bounds, so nothing narrower is invented
 * here (CLAUDE.md §16.4). Its purpose is to reject a value the column cannot store.
 */
export const MAX_EXPIRY_DAYS = 2_147_483_647;

/** One granted role or user on a pipeline. */
export interface PipelinePermissionNode {
  id: string;
  permissionType: PermissionType;
  roleId: string | null;
  userId: string | null;
  /** The grantee's display name, so the wizard can render the row without a second call. */
  label: string | null;
}

/**
 * Wizard step 3, as the API stores and returns it.
 *
 * Stages are ids: the service checks each belongs to this pipeline, and the foreign keys
 * keep them valid through a rename or a delete without a cascade. The expiry values are
 * kept even while `expiryEnabled` is false, so switching it back on restores the
 * configuration rather than an empty form.
 */
export interface PipelineSettingsNode {
  defaultStageId: string | null;
  mandatoryValueStageId: string | null;
  qualifiedStageId: string | null;
  autoConvertAtWon: boolean;
  expiryEnabled: boolean;
  expiryScope: ExpiryScope | null;
  expiryDays: number | null;
  expiredStageId: string | null;
  reassignedStageId: string | null;
  reassignExpiredToId: string | null;
}

/** One pipeline as `GET /api/pipelines` returns it — the reference table's five columns. */
export interface PipelineNode {
  id: string;
  name: string;
  shortCode: string | null;
  isDefault: boolean;
  /** Live leads on this pipeline — the reference list's "Leads" column. */
  leadCount: number;
  createdByName: string | null;
  createdAt: Date;
  accessMode: PipelineAccessMode;
  templateKey: string | null;
  permissions: PipelinePermissionNode[];
  settings: PipelineSettingsNode;
}

/** One row of the wizard's Pipeline Permissions list. */
export class PipelinePermissionDto {
  @IsIn([...PERMISSION_TYPES], { message: 'Choose Role or User.' })
  permissionType!: PermissionType;

  @IsOptional()
  @IsUUID('all')
  roleId?: string;

  @IsOptional()
  @IsUUID('all')
  userId?: string;
}

/**
 * Wizard step 3's payload.
 *
 * Sending the block at all means the step was submitted, which is why `defaultStageId` is
 * required here rather than optional — the reference marks it with an asterisk. The
 * remaining rules are conditional on `expiryEnabled` and live in the service, where the
 * stage ids are checked against the pipeline in the same pass.
 */
export class PipelineSettingsDto {
  @IsUUID('all', { message: 'Choose a default stage.' })
  defaultStageId!: string;

  @IsOptional()
  @IsUUID('all')
  mandatoryValueStageId?: string | null;

  @IsOptional()
  @IsUUID('all')
  qualifiedStageId?: string | null;

  @IsOptional()
  @IsBoolean()
  autoConvertAtWon?: boolean;

  @IsOptional()
  @IsBoolean()
  expiryEnabled?: boolean;

  @IsOptional()
  @IsIn([...EXPIRY_SCOPES], {
    message: 'Choose All Leads or Individual Leads.',
  })
  expiryScope?: ExpiryScope | null;

  @IsOptional()
  @IsInt({ message: 'Expire After (Days) must be a whole number of days.' })
  @Min(MIN_EXPIRY_DAYS, {
    message: 'Expire After (Days) must be at least 1 day.',
  })
  @Max(MAX_EXPIRY_DAYS)
  expiryDays?: number | null;

  @IsOptional()
  @IsUUID('all')
  expiredStageId?: string | null;

  @IsOptional()
  @IsUUID('all')
  reassignedStageId?: string | null;

  /** Not required even with expiry on: the reference marks it without an asterisk. */
  @IsOptional()
  @IsUUID('all')
  reassignExpiredToId?: string | null;
}

export class CreatePipelineDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Pipeline name is required.' })
  @MaxLength(MAX_PIPELINE_NAME)
  name!: string;

  /**
   * The reference placeholder reads "e.g. SALES or SL", so this is a short identifier
   * rather than free text: letters, digits, dash and underscore, stored uppercase.
   */
  @Transform(upper)
  @IsString()
  @MinLength(1, { message: 'Short code is required.' })
  @MaxLength(MAX_SHORT_CODE)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'Short code may use letters, numbers, dash and underscore only.',
  })
  shortCode!: string;

  @IsOptional()
  @IsIn([...PIPELINE_ACCESS_MODES])
  accessMode?: PipelineAccessMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PipelinePermissionDto)
  permissions?: PipelinePermissionDto[];

  /** Set only when the wizard's clone toggle is on; then it is required by the service. */
  @IsOptional()
  @IsIn([...PIPELINE_TEMPLATES], { message: 'Pick a template from the list.' })
  templateKey?: PipelineTemplate;
}

export class UpdatePipelineDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Pipeline name is required.' })
  @MaxLength(MAX_PIPELINE_NAME)
  name?: string;

  @IsOptional()
  @Transform(upper)
  @IsString()
  @MinLength(1, { message: 'Short code is required.' })
  @MaxLength(MAX_SHORT_CODE)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'Short code may use letters, numbers, dash and underscore only.',
  })
  shortCode?: string;

  @IsOptional()
  @IsIn([...PIPELINE_ACCESS_MODES])
  accessMode?: PipelineAccessMode;

  /** Present replaces the whole grant list; absent leaves it untouched. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PipelinePermissionDto)
  permissions?: PipelinePermissionDto[];

  /** Wizard step 3. Absent leaves every stored setting untouched — step 1 sends none. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineSettingsDto)
  settings?: PipelineSettingsDto;
}
