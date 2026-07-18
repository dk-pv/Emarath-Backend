import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
