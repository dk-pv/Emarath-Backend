import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { LeadCustomFieldType } from '../../generated/prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Create a custom column (LEAD-05.1) from the "Add Column" field-type menu. Only the
 * display name and type come from the client — the stable "cf_<slug>" key and the
 * position are derived server-side, so a client cannot forge a colliding key.
 */
export class CreateLeadCustomFieldDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Field name is required' })
  @MaxLength(180)
  name!: string;

  @IsEnum(LeadCustomFieldType, { message: 'Unknown field type' })
  type!: LeadCustomFieldType;
}

/** The definition shape returned to the client (never wider than this). */
export interface LeadCustomFieldDto {
  id: string;
  key: string;
  name: string;
  type: LeadCustomFieldType;
  position: number;
}
