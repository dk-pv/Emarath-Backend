import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ActivityType } from '../../generated/prisma/client';

/**
 * The Edit Follow-up drawer's payload (ACT-05.1) — the create fields minus
 * `leadId` (a follow-up's lead is fixed). The form submits the full editable set,
 * so this is a full replace of those fields, not a sparse patch; the type-
 * conditional rules stay in the service, as on create. Kept hand-written to match
 * the create DTO's style rather than pull in a mapped-types dependency.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

const MAX_ASSIGNEES = 50;
const MAX_DESCRIPTION = 2000;

export class UpdateActivityDto {
  @IsEnum(ActivityType, {
    message: 'Follow Up Type must be Call, Meeting or Task',
  })
  type!: ActivityType;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Follow-up Description is required' })
  @MaxLength(MAX_DESCRIPTION)
  description!: string;

  @IsDateString({}, { message: 'Due date/time must be a valid date' })
  dueAt!: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'End time must be a valid date' })
  @IsOptional()
  endAt?: string;

  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'location must be a valid id' })
  @IsOptional()
  locationId?: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'at least one assignee is required' })
  @ArrayMaxSize(MAX_ASSIGNEES)
  @IsUUID('all', { each: true, message: 'each assignee must be a valid id' })
  assigneeIds!: string[];
}
