import { Transform } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * A passive tracking location point (GPS-03.1). Coordinates are validated to
 * real lat/lng ranges (reuses the GPS-02.1 check-in validation). The agent is
 * the authenticated caller, never a body field. `at` defaults to now — later
 * GPS tasks may supply a device-captured timestamp.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

export class RecordLocationPointDto {
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
