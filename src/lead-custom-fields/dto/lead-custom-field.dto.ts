import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LeadCustomFieldType } from '../../generated/prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toInt = ({ value }: { value: unknown }): unknown => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : value;
};

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * The six field types the Settings > Custom Field screen offers, in the reference's own
 * dropdown order, with the labels it prints. `TEXT` and `TEXT_BOX` are deliberately
 * distinct: one is a single line, the other the multi-line box the lead form renders as
 * a textarea (ADR-0072).
 */
export const CUSTOM_FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'TEXTBOX', label: 'Text Box' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'DATETIME', label: 'Date Time' },
  { value: 'DROP_DOWN', label: 'Drop Down' },
] as const satisfies readonly { value: LeadCustomFieldType; label: string }[];

export const MAX_FIELD_NAME = 180;
export const MAX_OPTION_LABEL = 180;
/** A dropdown with more options than this is a lookup table, not a field. */
export const MAX_FIELD_OPTIONS = 1000;

export const CUSTOM_FIELD_PAGE_SIZES = [10, 25, 50] as const;

/** One selectable value of a DROP_DOWN field. */
export class LeadCustomFieldOptionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'An option cannot be blank.' })
  @MaxLength(MAX_OPTION_LABEL)
  label!: string;

  @IsInt()
  position!: number;
}

/**
 * Create a custom field. Only the label, type, status and (for a dropdown) its options
 * come from the client — the stable "cf_<slug>" key and the column position are derived
 * server-side, so a client cannot forge a colliding key.
 */
export class CreateLeadCustomFieldDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Field Label is required' })
  @MaxLength(MAX_FIELD_NAME)
  name!: string;

  @IsEnum(LeadCustomFieldType, { message: 'Unknown field type' })
  type!: LeadCustomFieldType;

  /** The reference's Add form opens with the status switch on. */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_FIELD_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => LeadCustomFieldOptionDto)
  @IsOptional()
  options?: LeadCustomFieldOptionDto[];
}

/**
 * Edit a custom field.
 *
 * `type` is accepted but the service refuses to change it once the field holds values:
 * the type is how every stored value is *interpreted*, so switching TEXT to NUMBER would
 * silently reinterpret history. The label may always change — the identity is the key,
 * never the label (ADR-0072).
 */
export class UpdateLeadCustomFieldDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Field Label is required' })
  @MaxLength(MAX_FIELD_NAME)
  name!: string;

  @IsEnum(LeadCustomFieldType, { message: 'Unknown field type' })
  type!: LeadCustomFieldType;

  @IsBoolean()
  isActive!: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_FIELD_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => LeadCustomFieldOptionDto)
  @IsOptional()
  options?: LeadCustomFieldOptionDto[];
}

/** The settings list's query: the reference's Search box and Field Type filter, paged. */
export class ListLeadCustomFieldsQueryDto {
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_FIELD_NAME)
  @IsOptional()
  search?: string;

  @IsEnum(LeadCustomFieldType, { message: 'Unknown field type' })
  @IsOptional()
  type?: LeadCustomFieldType;

  @Transform(toBool)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Transform(toInt)
  @IsIn(CUSTOM_FIELD_PAGE_SIZES, { message: 'Unsupported page size' })
  @IsOptional()
  size?: number;
}

/** The definition shape returned to the client (never wider than this). */
export interface LeadCustomFieldDto {
  id: string;
  key: string;
  name: string;
  type: LeadCustomFieldType;
  position: number;
  isActive: boolean;
  /** Always present; empty for every type but DROP_DOWN. */
  options: { id: string; label: string; position: number }[];
}

export interface LeadCustomFieldPage {
  rows: LeadCustomFieldDto[];
  total: number;
}
