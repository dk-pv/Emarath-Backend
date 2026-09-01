import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizeFilterValues } from '../../leads/lead-filter';
import {
  DEFAULT_REPORT_PAGE_SIZE,
  MAX_FILTER_VALUES,
  MAX_REPORT_PAGE_SIZE,
  toOptionalBoolean,
} from './no-activity-query.dto';

/** `Lead.status` is `VarChar(120)`; a longer value can never match a row. */
const MAX_VALUE_LENGTH = 120;

/** Aging thresholds are days; a year is far past any useful ageing bucket. */
export const MAX_THRESHOLD_DAYS = 365;

/** The reference's defaults: Green ≤13d · Amber ≤29d · Red ≥30d. */
export const DEFAULT_GREEN_DAYS = 13;
export const DEFAULT_AMBER_DAYS = 29;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Lead Aging & Stale Leads query (RPT-02.8): paging, the toolbar's agent/status
 * filters, the creation window the breakdown's period dropdown sends, the two aging
 * thresholds, and whether closed-lost leads are tracked at all.
 *
 * The thresholds ride the query so the server buckets exactly what the toolbar shows —
 * the client never re-buckets rows the server counted.
 */
export class LeadAgingQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be 1 or greater' })
  @IsOptional()
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'size must be an integer' })
  @Min(1, { message: 'size must be 1 or greater' })
  @Max(MAX_REPORT_PAGE_SIZE, {
    message: `size must be at most ${MAX_REPORT_PAGE_SIZE}`,
  })
  @IsOptional()
  size: number = DEFAULT_REPORT_PAGE_SIZE;

  /** The creation window's bounds — ISO instants the client computes in its own timezone. */
  @Transform(trim)
  @IsDateString({}, { message: 'from must be an ISO date' })
  @IsOptional()
  from?: string;

  @Transform(trim)
  @IsDateString({}, { message: 'to must be an ISO date' })
  @IsOptional()
  to?: string;

  /** Assigned-agent user ids (toolbar "Sales Agent", and the breakdown's row click). */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'agent must be one or more values' })
  @IsUUID('all', { each: true, message: 'each agent must be a valid id' })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `agent accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  agent?: string[];

  /** Lead status names (toolbar "Lead Status"). */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'status must be one or more values' })
  @IsString({ each: true, message: 'each status must be a string' })
  @MaxLength(MAX_VALUE_LENGTH, {
    each: true,
    message: `each status must be at most ${MAX_VALUE_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `status accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  status?: string[];

  /** Only leads with no assignee — what the breakdown's "Unassigned" row drills into. */
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: 'unassigned must be a boolean' })
  @IsOptional()
  unassigned?: boolean;

  /** Include closed-lost leads in the tracked set (the checkbox); off by default. */
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: 'includeLost must be a boolean' })
  @IsOptional()
  includeLost?: boolean;

  /** Upper bound of the healthy band, in days (default 13). */
  @Type(() => Number)
  @IsInt({ message: 'green must be an integer' })
  @Min(1, { message: 'green must be 1 or greater' })
  @Max(MAX_THRESHOLD_DAYS, {
    message: `green must be at most ${MAX_THRESHOLD_DAYS}`,
  })
  @IsOptional()
  green: number = DEFAULT_GREEN_DAYS;

  /** Upper bound of the needs-attention band, in days (default 29); anything older is stale. */
  @Type(() => Number)
  @IsInt({ message: 'amber must be an integer' })
  @Min(1, { message: 'amber must be 1 or greater' })
  @Max(MAX_THRESHOLD_DAYS, {
    message: `amber must be at most ${MAX_THRESHOLD_DAYS}`,
  })
  @IsOptional()
  amber: number = DEFAULT_AMBER_DAYS;

  /**
   * One agent the details table is narrowed to on top of every other filter — what the
   * breakdown's row click sends. Kept apart from `agent` (which is an OR over the
   * toolbar's picks) so a row click intersects the current context instead of replacing it.
   */
  @Transform(trim)
  @IsUUID('all', { message: 'owner must be a valid id' })
  @IsOptional()
  owner?: string;

  /** Which column the details table is ordered by; unknown keys fall back to the default. */
  @Transform(trim)
  @IsString({ message: 'sort must be a string' })
  @MaxLength(40, { message: 'sort must be at most 40 characters' })
  @IsOptional()
  sort?: string;

  @Transform(trim)
  @IsIn(['asc', 'desc'], { message: 'direction must be asc or desc' })
  @IsOptional()
  direction?: 'asc' | 'desc';
}
