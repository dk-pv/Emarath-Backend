import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Filter for GPS-04.1 summary counters.
 * The period is bounded by dateFrom and dateTo.
 * Managers can optionally filter by userId (Team Member).
 */
export class GpsSummaryFilterDto {
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'userId must be a valid id' })
  @IsOptional()
  userId?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'dateFrom must be a valid date' })
  @IsOptional()
  dateFrom?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'dateTo must be a valid date' })
  @IsOptional()
  dateTo?: string;
}
