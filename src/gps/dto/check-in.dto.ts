import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * A field check-in (GPS-02.1). Coordinates are validated to real lat/lng ranges
 * so a missing or out-of-range value fails with a clear message (AC5). The agent
 * is the authenticated caller, never a body field (AC4). `activityId` optionally
 * ties the visit to the follow-up it verifies (AC3); `at` defaults to now.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

export class CheckInDto {
  @IsNumber({}, { message: 'latitude must be a number' })
  @Min(-90, { message: 'latitude must be between -90 and 90' })
  @Max(90, { message: 'latitude must be between -90 and 90' })
  latitude!: number;

  @IsNumber({}, { message: 'longitude must be a number' })
  @Min(-180, { message: 'longitude must be between -180 and 180' })
  @Max(180, { message: 'longitude must be between -180 and 180' })
  longitude!: number;

  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'activityId must be a valid id' })
  @IsOptional()
  activityId?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'at must be a valid date' })
  @IsOptional()
  at?: string;
}
