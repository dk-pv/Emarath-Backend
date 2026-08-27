import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A saved filter as the client receives it (ADR-0052). `conditions` is the very JSON
 * payload `GET /leads?conditions=` accepts, so applying a preset is a straight
 * hand-off — the client never re-encodes it and the two can never drift.
 */
export interface SavedFilterResponse {
  id: string;
  name: string;
  conditions: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The payload cap matches `ListLeadsQueryDto.conditions` (8000): a preset must never
 * hold a filter too large to then send as a query param.
 */
const MAX_CONDITIONS = 8000;
const MAX_NAME = 120;

export class CreateSavedFilterDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(MAX_NAME)
  name!: string;

  @IsString({ message: 'conditions must be a JSON string' })
  @MaxLength(MAX_CONDITIONS, { message: 'conditions payload is too large' })
  conditions!: string;
}

/** Rename, re-save the conditions, or both — everything omitted is left as it is. */
export class UpdateSavedFilterDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name cannot be empty' })
  @MaxLength(MAX_NAME)
  name?: string;

  @IsOptional()
  @IsString({ message: 'conditions must be a JSON string' })
  @MaxLength(MAX_CONDITIONS, { message: 'conditions payload is too large' })
  conditions?: string;
}
