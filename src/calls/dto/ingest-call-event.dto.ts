import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { CallDirection, CallOutcome } from '../../generated/prisma/client';

/**
 * A single normalized call event handed to ingestion (CALL-02.1). This is OUR
 * contract, not 3CX's wire format: the PBX-specific webhook/API payload and its
 * adapter are deferred with the live 3CX transport (that schema is not yet
 * available). `agentId`/`leadId` are already resolved to our ids upstream —
 * the extension→user map and the phone→lead lookup (CALL-02.2) own that.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

const MAX_NOTES = 5000;

export class IngestCallEventDto {
  /** The PBX call id — ingestion is idempotent on this (AC5). */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'externalId is required for de-duplication' })
  @MaxLength(128)
  externalId!: string;

  /** Pre-resolved lead; when absent, ingestion best-effort matches by phone (AC3). */
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'leadId must be a valid id' })
  @IsOptional()
  leadId?: string;

  @IsUUID('all', { message: 'agentId must be a valid id' })
  agentId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'phone is required' })
  @MaxLength(32)
  phone!: string;

  @IsDateString({}, { message: 'startedAt must be a valid date' })
  startedAt!: string;

  @IsEnum(CallDirection, { message: 'direction must be INBOUND or OUTBOUND' })
  direction!: CallDirection;

  @IsEnum(CallOutcome, {
    message: 'outcome must be ANSWERED, NO_ANSWER or BUSY',
  })
  outcome!: CallOutcome;

  /** Seconds; a missed/abandoned call is 0. */
  @IsInt({ message: 'duration must be a whole number of seconds' })
  @Min(0)
  duration!: number;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(MAX_NOTES)
  @IsOptional()
  leadNotes?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(MAX_NOTES)
  @IsOptional()
  callNotes?: string;
}
