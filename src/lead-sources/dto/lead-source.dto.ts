import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Matches `lead_sources.name` and `Lead.source`, which the name is written into. */
export const MAX_LEAD_SOURCE_NAME = 64;

/** One lead source as `GET /api/lead-sources` returns it — the reference table's columns. */
export interface LeadSourceNode {
  id: string;
  name: string;
  isActive: boolean;
  /** Live leads carrying this source's name — what blocks a delete. */
  leadCount: number;
  createdByName: string | null;
  createdAt: Date;
}

export class CreateLeadSourceDto {
  /**
   * Trimmed before validation, so a name of only spaces fails `MinLength` rather than
   * being stored as whitespace.
   */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Source name is required.' })
  @MaxLength(MAX_LEAD_SOURCE_NAME)
  name!: string;

  /** The reference's Add drawer opens with the switch on. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateLeadSourceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Source name is required.' })
  @MaxLength(MAX_LEAD_SOURCE_NAME)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
