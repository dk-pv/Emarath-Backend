import { Transform } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * The matching check-out for an open check-in (GPS-02.1 AC2). Same coordinate
 * validation as check-in (AC5); the check-in to close is the `:id` in the path,
 * scoped to the calling agent. `at` defaults to now.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

export class CheckOutDto {
  @IsNumber({}, { message: 'latitude must be a number' })
  @Min(-90, { message: 'latitude must be between -90 and 90' })
  @Max(90, { message: 'latitude must be between -90 and 90' })
  latitude!: number;

  @IsNumber({}, { message: 'longitude must be a number' })
  @Min(-180, { message: 'longitude must be between -180 and 180' })
  @Max(180, { message: 'longitude must be between -180 and 180' })
  longitude!: number;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'at must be a valid date' })
  @IsOptional()
  at?: string;
}
