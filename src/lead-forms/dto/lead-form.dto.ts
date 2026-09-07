import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toInt = ({ value }: { value: unknown }): unknown => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : value;
};

/** The record a form builds. The reference's table shows one module: Lead. */
export const FORM_MODULES = ['LEAD'] as const;
export type FormModule = (typeof FORM_MODULES)[number];

export const MAX_FORM_NAME = 160;
export const MAX_SECTION_NAME = 120;
/** A form is a form, not an outline: far more sections than any captured layout uses. */
export const MAX_FORM_SECTIONS = 50;
export const FORM_PAGE_SIZES = [10, 25, 50] as const;
/** The system catalogue plus a generous allowance for custom fields. */
export const MAX_FORM_FIELDS = 200;

/**
 * The Lead record's own fields and the four a lead cannot be created without. Defined in
 * their own decorator-free module so the seed can import them without `reflect-metadata`.
 */
export {
  LEAD_SYSTEM_FIELDS,
  LEAD_SYSTEM_FIELD_KEYS,
  REQUIRED_LEAD_FIELD_KEYS,
} from '../lead-system-fields';

/** One section of the builder's Selected panel. */
export class LeadFormSectionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Section Name is required.' })
  @MaxLength(MAX_SECTION_NAME)
  name!: string;

  @IsInt()
  @Min(0)
  position!: number;
}

/** One entry of the builder's field list. */
export class LeadFormFieldDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  fieldKey!: string;

  @IsInt()
  @Min(0)
  position!: number;

  @IsBoolean()
  isVisible!: boolean;

  /**
   * The section this field sits in, addressed by name — section names are unique per
   * form, and a name survives the round trip a client-generated id would not.
   * Null or absent puts the field in the form's ungrouped top block.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null,
  )
  @IsString()
  @MaxLength(MAX_SECTION_NAME)
  @ValidateIf((dto: LeadFormFieldDto) => dto.sectionName !== null)
  @IsOptional()
  sectionName?: string | null;
}

/** The Add / Edit Lead Form payload. */
export class SaveLeadFormDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Form Name is required.' })
  @MaxLength(MAX_FORM_NAME)
  name!: string;

  @IsIn(FORM_MODULES, { message: 'Unknown module.' })
  module!: FormModule;

  @IsBoolean()
  isActive!: boolean;

  /**
   * Making this form the default clears the previous one in the same transaction.
   * Sending `false` on the current default is refused — a module always has a default.
   */
  @IsBoolean()
  isDefault!: boolean;

  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one field.' })
  @ArrayMaxSize(MAX_FORM_FIELDS)
  @ValidateNested({ each: true })
  @Type(() => LeadFormFieldDto)
  fields!: LeadFormFieldDto[];

  /** The form's sections, in render order. Absent means an ungrouped form. */
  @IsArray()
  @ArrayMaxSize(MAX_FORM_SECTIONS)
  @ValidateNested({ each: true })
  @Type(() => LeadFormSectionDto)
  @IsOptional()
  sections?: LeadFormSectionDto[];
}

/** The Settings list's query. */
export class ListLeadFormsQueryDto {
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_FORM_NAME)
  @IsOptional()
  search?: string;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Transform(toInt)
  @IsIn(FORM_PAGE_SIZES, { message: 'Unsupported page size' })
  @IsOptional()
  size?: number;
}

/** One field on a form, resolved against the catalogue so the client needs no join. */
export interface LeadFormFieldItem {
  fieldKey: string;
  label: string;
  position: number;
  isVisible: boolean;
  /** A required system field: it is on every form and cannot be hidden. */
  isRequired: boolean;
  source: 'SYSTEM' | 'CUSTOM';
  /** Null for the form's ungrouped top block. */
  sectionName: string | null;
}

export interface LeadFormSectionItem {
  name: string;
  position: number;
}

export interface LeadFormItem {
  id: string;
  name: string;
  module: FormModule;
  isActive: boolean;
  isDefault: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  fields: LeadFormFieldItem[];
  sections: LeadFormSectionItem[];
}

export interface LeadFormPage {
  rows: LeadFormItem[];
  total: number;
}

/** What the builder offers: every system field plus every active custom field. */
export interface AvailableFormField {
  fieldKey: string;
  label: string;
  isRequired: boolean;
  source: 'SYSTEM' | 'CUSTOM';
  /**
   * How the field is captured — the custom field's own type, or the control the Lead
   * drawer renders for a system field. The builder's information icon and the Preview
   * both read this rather than guessing from the label.
   */
  type: string;
  /** A DROP_DOWN custom field's configured options, in order. Empty otherwise. */
  options: string[];
}
