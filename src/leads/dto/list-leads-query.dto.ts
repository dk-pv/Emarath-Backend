import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizeFilterValues } from '../lead-filter';

/**
 * Columns the list may be ordered by (LEAD-02.1 AC2).
 *
 * A whitelist, not a passthrough: `sort` reaches Prisma's `orderBy` as a key,
 * so an unchecked value lets a caller order by any column in the table — or
 * error the query — and AC5 requires a clear rejection instead.
 */
export const LEAD_SORT_COLUMNS = [
  'name',
  'firstName',
  'primaryPhone',
  'status',
  'source',
  'language',
  'country',
  'category',
  'actualAmount',
  'forecastedAmount',
  'bookingDate',
  'callStatus',
  'callAttempts',
  'whatsappAttempts',
  'createdAt',
  'updatedAt',
] as const;

export type LeadSortColumn = (typeof LEAD_SORT_COLUMNS)[number];

export const DEFAULT_PAGE_SIZE = 100;

/** Guards the database against a caller asking for the whole 15,000-row table. */
export const MAX_PAGE_SIZE = 200;

/** A search longer than this is never a real query; reject it before the DB. */
export const MAX_SEARCH_LENGTH = 200;

/**
 * A filter can carry at most this many values (LEAD-03.2). Source and Status are
 * short enumerations and an agent list is bounded; a request past this is abuse,
 * not a real view, and each value becomes an `IN` element the DB must plan.
 */
export const MAX_FILTER_VALUES = 100;

/** Source and Status are `VarChar(64)`; a longer value can never match a row. */
export const MAX_FILTER_VALUE_LENGTH = 64;

export class ListLeadsQueryDto {
  /** 1-based, matching what the pager shows. */
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

  @IsIn(LEAD_SORT_COLUMNS, {
    message: `sort must be one of: ${LEAD_SORT_COLUMNS.join(', ')}`,
  })
  @IsOptional()
  sort: LeadSortColumn = 'createdAt';

  /** Workpex opens the list newest-first. */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'], { message: 'direction must be asc or desc' })
  @IsOptional()
  direction: 'asc' | 'desc' = 'desc';

  /**
   * Free-text search over Customer Name and Primary Phone (LEAD-03.1).
   *
   * Trimmed here so a whitespace-only value arrives as an empty string, which the
   * search builder treats as "no search" (AC5). Length-capped before it can reach
   * the database.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'search must be a string' })
  @MaxLength(MAX_SEARCH_LENGTH, {
    message: `search must be at most ${MAX_SEARCH_LENGTH} characters`,
  })
  @IsOptional()
  search?: string;

  /**
   * Field filters (LEAD-03.2). Each accepts one or more values, repeated in the
   * query string (`?source=A&source=B`); a single value is coerced to a one-item
   * array and a blank one to no filter (AC5). Values combine as OR within a
   * field and AND across fields, applied in the service alongside scope, search
   * and sort (AC2/AC4).
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'source must be one or more values' })
  @IsString({ each: true, message: 'each source must be a string' })
  @MaxLength(MAX_FILTER_VALUE_LENGTH, {
    each: true,
    message: `each source must be at most ${MAX_FILTER_VALUE_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `source accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  source?: string[];

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

  /** Assigned Agent filter — user ids matched through the assignment join. */
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
}
