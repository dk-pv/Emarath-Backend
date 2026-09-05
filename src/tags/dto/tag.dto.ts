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

/** Matches `tags.name`. */
export const MAX_TAG_NAME = 80;

/** One tag as `GET /api/tags` returns it — the reference table's four columns. */
export interface TagNode {
  id: string;
  name: string;
  isActive: boolean;
  /** Leads carrying this tag — the reference's "Lead Count" column. */
  leadCount: number;
}

export class CreateTagDto {
  /**
   * Trimmed before validation, so a name of only spaces fails `MinLength` rather than
   * being stored as whitespace.
   */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Tags name is required.' })
  @MaxLength(MAX_TAG_NAME)
  name!: string;

  /** The reference's Add drawer opens with the switch on. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTagDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Tags name is required.' })
  @MaxLength(MAX_TAG_NAME)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
