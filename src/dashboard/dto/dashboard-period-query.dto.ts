import { Transform } from 'class-transformer';
import { IsDateString, IsOptional } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The window one Dashboard widget covers (DASH-01.2).
 *
 * Only the range — unlike the KPI counters, none of the team widgets needs the
 * caller's local midnight, because none of them means anything by "overdue". Both
 * bounds absent is the All preset: no date predicate at all.
 */
export class DashboardPeriodQueryDto {
  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'from must be a valid date' })
  @IsOptional()
  from?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'to must be a valid date' })
  @IsOptional()
  to?: string;
}
