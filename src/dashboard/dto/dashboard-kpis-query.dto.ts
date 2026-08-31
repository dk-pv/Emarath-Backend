import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { KPI_KEYS, type KpiKey } from '../dashboard-kpis';

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * `?counters=a&counters=b` and `?counters=a,b` both arrive here. Anything that is
 * neither a string nor an array of them is passed through untouched, so the enum
 * validator rejects it rather than this coercing an object into a bogus key.
 */
const toKeyArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === '') return undefined;
  const list = Array.isArray(value) ? value : [value];
  if (!list.every((entry) => typeof entry === 'string')) return value;
  return list
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
};

/**
 * The window one KPI covers (DASH-02.1 AC2/AC5).
 *
 * Each Dashboard card carries its own period (DASH-01.2), so the caller asks for
 * one window at a time and names the counters it wants — a card requests only its
 * own, which is what keeps six independently-filtered cards from each computing
 * all six counters. Omitting `counters` returns all six (AC1).
 *
 * `from`/`to` are the resolved half-open window, absent for the "All" preset.
 * `todayStart` is the caller's local midnight and is always required, because
 * "overdue" is defined against the caller's own today (ADR-0028 §3).
 */
export class DashboardKpisQueryDto {
  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'todayStart must be a valid date' })
  todayStart!: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'from must be a valid date' })
  @IsOptional()
  from?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'to must be a valid date' })
  @IsOptional()
  to?: string;

  @Transform(toKeyArray)
  @IsEnum(KPI_KEYS, {
    each: true,
    message: `counters must be one of: ${KPI_KEYS.join(', ')}`,
  })
  @IsOptional()
  counters?: KpiKey[];
}
