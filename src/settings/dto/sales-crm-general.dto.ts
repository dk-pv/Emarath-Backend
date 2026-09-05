import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '../../generated/prisma/client';

/**
 * The Settings key this screen occupies in `app_settings`.
 *
 * One row per Settings screen; the remaining Sales & CRM screens (Category, Sales
 * Pipeline, Lead Source, Tags, Duplicate Settings) get their own keys and their own DTOs.
 */
export const SALES_CRM_GENERAL_KEY = 'sales-crm-general';

/**
 * The choice sets behind this screen's selects.
 *
 * Only the values the Workpex reference actually shows are listed. The screenshots
 * capture each dropdown's *current value*, never its open panel, so any second option
 * would be invented product vocabulary (CLAUDE.md §16.4). Adding one when the open-state
 * screenshots arrive is a one-line change here — the DTO, the API and the UI all read
 * these constants.
 */
export const LEAD_DISPLAY_MODES = ['ALL_LEADS'] as const;
export const LEAD_DISPLAY_ORDERS = ['BY_DATE'] as const;
export const TAG_PERMISSIONS = ['ALL_USERS'] as const;
export const NO_ACTIVITY_UNITS = ['HOURS'] as const;

/** Both options are visible in the reference, so these sets are complete. */
export const LEAD_ORDER_FIELDS = [
  'LAST_CREATED_DATE',
  'LAST_EDITED_DATE',
] as const;
export const NOTE_DISPLAY_TYPES = [
  'LEAD_PRIMARY_NOTE',
  'LAST_ADDED_NOTE',
] as const;
export const PIPELINE_CHANGE_ASSIGNEES = ['SAME_USER', 'UNASSIGN'] as const;

/** Trailing digits hidden when mobile masking is on; a count, not a vocabulary. */
export const MIN_MASK_DIGITS = 1;
export const MAX_MASK_DIGITS = 8;

/** Whole hours, bounded so a typo cannot store a threshold no alert would ever reach. */
export const MIN_NO_ACTIVITY_THRESHOLD = 1;
export const MAX_NO_ACTIVITY_THRESHOLD = 8760;

export type LeadDisplayMode = (typeof LEAD_DISPLAY_MODES)[number];
export type LeadDisplayOrder = (typeof LEAD_DISPLAY_ORDERS)[number];
export type LeadOrderField = (typeof LEAD_ORDER_FIELDS)[number];
export type NoteDisplayType = (typeof NOTE_DISPLAY_TYPES)[number];
export type TagPermission = (typeof TAG_PERMISSIONS)[number];
export type PipelineChangeAssignee = (typeof PIPELINE_CHANGE_ASSIGNEES)[number];
export type NoActivityUnit = (typeof NO_ACTIVITY_UNITS)[number];

/**
 * The display labels the Leads module uses for eight built-in fields.
 *
 * This renames existing columns for the whole app — it is not `LeadCustomField`, which
 * adds *new* user-defined fields. The two are unrelated despite the similar wording in
 * the reference.
 */
export interface CustomFieldNames {
  state: string;
  district: string;
  city: string;
  zipcode: string;
  actualAmount: string;
  forecastedAmount: string;
  tag: string;
  category: string;
}

/** The whole Sales & CRM → General Settings payload, as the API returns it. */
export interface SalesCrmGeneralSettings {
  displayLeads: LeadDisplayMode;
  displayOrder: LeadDisplayOrder;
  orderBy: LeadOrderField;
  requireCompanyName: boolean;
  noteDisplay: NoteDisplayType;
  fieldNames: CustomFieldNames;
  actualAmountTimeline: boolean;
  /** ISO 3166-1 alpha-2, matching the frontend's shipped country dataset. */
  defaultCountryCode: string;
  tagPermission: TagPermission;
  maskMobileNumbers: boolean;
  /** Which role still sees unmasked numbers; null while masking is off. */
  maskingRole: UserRole | null;
  maskDigits: number;
  pipelineChangeAssignee: PipelineChangeAssignee;
  noActivityThreshold: number;
  noActivityUnit: NoActivityUnit;
  noActivityNotifications: boolean;
}

/**
 * The shipped defaults, and the exact state the Workpex reference screenshots show.
 *
 * Returned until an administrator saves for the first time, and used field-by-field when
 * a stored row is missing a key — so a payload written before a field existed still reads
 * back complete.
 */
export const SALES_CRM_GENERAL_DEFAULTS: SalesCrmGeneralSettings = {
  displayLeads: 'ALL_LEADS',
  displayOrder: 'BY_DATE',
  orderBy: 'LAST_CREATED_DATE',
  requireCompanyName: false,
  noteDisplay: 'LAST_ADDED_NOTE',
  fieldNames: {
    state: 'State',
    district: 'District',
    city: 'City',
    zipcode: 'Pincode',
    actualAmount: 'Actual Amount',
    forecastedAmount: 'Forecasted Amount',
    tag: 'Tags',
    category: 'Category',
  },
  actualAmountTimeline: false,
  defaultCountryCode: 'AE',
  tagPermission: 'ALL_USERS',
  maskMobileNumbers: false,
  maskingRole: null,
  maskDigits: 4,
  pipelineChangeAssignee: 'SAME_USER',
  noActivityThreshold: 18,
  noActivityUnit: 'HOURS',
  noActivityNotifications: false,
};

/** Every label is required and bounded; a blank rename would leave a column unnamed. */
export class CustomFieldNamesDto implements CustomFieldNames {
  @IsString() @MinLength(1) @MaxLength(60) state!: string;
  @IsString() @MinLength(1) @MaxLength(60) district!: string;
  @IsString() @MinLength(1) @MaxLength(60) city!: string;
  @IsString() @MinLength(1) @MaxLength(60) zipcode!: string;
  @IsString() @MinLength(1) @MaxLength(60) actualAmount!: string;
  @IsString() @MinLength(1) @MaxLength(60) forecastedAmount!: string;
  @IsString() @MinLength(1) @MaxLength(60) tag!: string;
  @IsString() @MinLength(1) @MaxLength(60) category!: string;
}

/**
 * A full replacement of the screen's settings — the form posts every field, so a partial
 * body would silently reset whatever it omitted.
 */
export class UpdateSalesCrmGeneralDto {
  @IsIn(LEAD_DISPLAY_MODES) displayLeads!: LeadDisplayMode;
  @IsIn(LEAD_DISPLAY_ORDERS) displayOrder!: LeadDisplayOrder;
  @IsIn(LEAD_ORDER_FIELDS) orderBy!: LeadOrderField;
  @IsBoolean() requireCompanyName!: boolean;
  @IsIn(NOTE_DISPLAY_TYPES) noteDisplay!: NoteDisplayType;

  @ValidateNested()
  @Type(() => CustomFieldNamesDto)
  fieldNames!: CustomFieldNamesDto;

  @IsBoolean() actualAmountTimeline!: boolean;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  defaultCountryCode!: string;

  @IsIn(TAG_PERMISSIONS) tagPermission!: TagPermission;
  @IsBoolean() maskMobileNumbers!: boolean;

  @IsOptional()
  @IsIn(Object.values(UserRole))
  maskingRole?: UserRole | null;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_MASK_DIGITS)
  @Max(MAX_MASK_DIGITS)
  maskDigits!: number;

  @IsIn(PIPELINE_CHANGE_ASSIGNEES)
  pipelineChangeAssignee!: PipelineChangeAssignee;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_NO_ACTIVITY_THRESHOLD)
  @Max(MAX_NO_ACTIVITY_THRESHOLD)
  noActivityThreshold!: number;

  @IsIn(NO_ACTIVITY_UNITS) noActivityUnit!: NoActivityUnit;
  @IsBoolean() noActivityNotifications!: boolean;
}
