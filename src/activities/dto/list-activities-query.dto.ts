import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
import {
  DEFAULT_PAGE_SIZE,
  MAX_FILTER_VALUE_LENGTH,
  MAX_FILTER_VALUES,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../leads/dto/list-leads-query.dto';
import { normalizeFilterValues } from '../../leads/lead-filter';
import { ACTIVITY_BUCKETS, type ActivityBucket } from '../activity-buckets';
import {
  ACTIVITY_DATE_WINDOWS,
  type ActivityDateWindow,
} from '../activity-date-windows';
import { ActivityType } from '../../generated/prisma/client';

const ACTIVITY_TYPES = Object.values(ActivityType);

/**
 * The Activities worklist query (ACT-02.1 + ACT-07.1). Reuses the Leads
 * pagination shape — `page`/`size`, same default and cap. `bucket` selects the
 * tab. The three day boundaries are ISO instants the client computes in its own
 * timezone (ADR-0028 §3); they are required because the response always returns
 * per-bucket counts, which the date buckets are computed from. Search and the
 * assignee/status/pipeline filters (ACT-07.1) reuse the Leads DTO's transforms,
 * caps and `normalizeFilterValues` verbatim, and combine with the active tab.
 */
export class ListActivitiesQueryDto {
  @IsIn(ACTIVITY_BUCKETS, {
    message: `bucket must be one of: ${ACTIVITY_BUCKETS.join(', ')}`,
  })
  @IsOptional()
  bucket: ActivityBucket = 'all';

  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be 1 or greater' })
  @IsOptional()
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'size must be an integer' })
  @Min(1, { message: 'size must be 1 or greater' })
  @Max(MAX_PAGE_SIZE, { message: `size must be at most ${MAX_PAGE_SIZE}` })
  @IsOptional()
  size: number = DEFAULT_PAGE_SIZE;

  @IsDateString({}, { message: 'todayStart must be an ISO date' })
  todayStart!: string;

  @IsDateString({}, { message: 'todayEnd must be an ISO date' })
  todayEnd!: string;

  @IsDateString({}, { message: 'tomorrowEnd must be an ISO date' })
  tomorrowEnd!: string;

  /** Free-text over Customer Name + activity title (AC1). Trimmed, length-capped. */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'search must be a string' })
  @MaxLength(MAX_SEARCH_LENGTH, {
    message: `search must be at most ${MAX_SEARCH_LENGTH} characters`,
  })
  @IsOptional()
  search?: string;

  /** Assignee filter — user ids matched through the assignee join (AC2). */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'assignedAgent must be one or more values' })
  @IsUUID('all', {
    each: true,
    message: 'each assignedAgent must be a valid id',
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `assignedAgent accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  assignedAgent?: string[];

  /** Lead-status filter, matched on the linked lead (AC2). */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'status must be one or more values' })
  @IsString({ each: true, message: 'each status must be a string' })
  @MaxLength(MAX_FILTER_VALUE_LENGTH, {
    each: true,
    message: `each status must be at most ${MAX_FILTER_VALUE_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `status accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  status?: string[];

  /** Lead-pipeline filter, matched on the linked lead (AC2). */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'pipeline must be one or more values' })
  @IsString({ each: true, message: 'each pipeline must be a string' })
  @MaxLength(MAX_FILTER_VALUE_LENGTH, {
    each: true,
    message: `each pipeline must be at most ${MAX_FILTER_VALUE_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `pipeline accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  pipeline?: string[];

  /**
   * The filter popup's ticked quick-date checkboxes. Several may be sent; the
   * service ORs their windows and ANDs the result with the active tab.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'dateWindow must be one or more values' })
  @IsIn(ACTIVITY_DATE_WINDOWS, {
    each: true,
    message: `each dateWindow must be one of: ${ACTIVITY_DATE_WINDOWS.join(', ')}`,
  })
  @ArrayMaxSize(ACTIVITY_DATE_WINDOWS.length, {
    message: 'dateWindow accepts at most one value per window',
  })
  @IsOptional()
  dateWindow?: ActivityDateWindow[];

  /**
   * Edges for the windows that need more than the three tab boundaries. Sent only
   * when the matching checkbox is ticked, so an unticked window costs nothing.
   */
  @IsDateString({}, { message: 'yesterdayStart must be an ISO date' })
  @IsOptional()
  yesterdayStart?: string;

  @IsDateString({}, { message: 'weekStart must be an ISO date' })
  @IsOptional()
  weekStart?: string;

  @IsDateString({}, { message: 'weekEnd must be an ISO date' })
  @IsOptional()
  weekEnd?: string;

  @IsDateString({}, { message: 'monthStart must be an ISO date' })
  @IsOptional()
  monthStart?: string;

  @IsDateString({}, { message: 'monthEnd must be an ISO date' })
  @IsOptional()
  monthEnd?: string;

  /** The popup's explicit From/To range, ANDed with the quick-date windows. */
  @IsDateString({}, { message: 'dueFrom must be an ISO date' })
  @IsOptional()
  dueFrom?: string;

  @IsDateString({}, { message: 'dueTo must be an ISO date' })
  @IsOptional()
  dueTo?: string;

  /** Follow-up type — the popup's "All Activities" dropdown. */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'type must be one or more values' })
  @IsIn(ACTIVITY_TYPES, {
    each: true,
    message: `each type must be one of: ${ACTIVITY_TYPES.join(', ')}`,
  })
  @ArrayMaxSize(ACTIVITY_TYPES.length, {
    message: 'type accepts at most one value per type',
  })
  @IsOptional()
  type?: ActivityType[];
}
