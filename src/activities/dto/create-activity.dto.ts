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
 * The Add Follow-up drawer's payload (ACT-03.1).
 *
 * Per-field shape only — the type-conditional rules (a Call has no End Time or
 * Location; End must not precede Start) are cross-field and keyed on `type`, so
 * they live in the service, not here. `description` is required in the form (C1,
 * resolved required by the video) even though the column is nullable for
 * imported rows, so requiredness is a rule about this form, not the schema.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

const MAX_ASSIGNEES = 50;
const MAX_DESCRIPTION = 2000;

export class CreateActivityDto {
  @IsEnum(ActivityType, {
    message: 'Follow Up Type must be Call, Meeting or Task',
  })
  type!: ActivityType;

  @IsUUID('all', { message: 'a valid lead is required' })
  leadId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Follow-up Description is required' })
  @MaxLength(MAX_DESCRIPTION)
  description!: string;

  /** Due Date + Start Time, composed by the client into one ISO datetime. */
  @IsDateString({}, { message: 'Due date/time must be a valid date' })
  dueAt!: string;

  /** Meeting/Task End Time only; the service rejects it on a Call. */
  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'End time must be a valid date' })
  @IsOptional()
  endAt?: string;

  /** Optional Location (Meeting/Task only); its catalogue is the GPS module's. */
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
