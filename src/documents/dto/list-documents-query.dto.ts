import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Columns the list may be ordered by (DOC-03.1 AC3).
 *
 * A whitelist, not a passthrough: `sort` reaches Prisma's `orderBy` as a key, so an
 * unchecked value would let a caller order by any column — or error the query. The
 * keys match the frontend Table column keys. `uploadedBy` is a relation sort mapped
 * to the uploader's name in the service.
 */
export const DOCUMENT_SORT_COLUMNS = [
  'title',
  'fileName',
  'sizeBytes',
  'contentType',
  'uploadedBy',
  'createdAt',
] as const;

export type DocumentSortColumn = (typeof DOCUMENT_SORT_COLUMNS)[number];

export const DEFAULT_PAGE_SIZE = 25;

/** Guards the database against a caller asking for an unbounded page. */
export const MAX_PAGE_SIZE = 100;

export class ListDocumentsQueryDto {
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

  @IsIn(DOCUMENT_SORT_COLUMNS, {
    message: `sort must be one of: ${DOCUMENT_SORT_COLUMNS.join(', ')}`,
  })
  @IsOptional()
  sort: DocumentSortColumn = 'createdAt';

  /** The list opens newest-first by "Date and Time". */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'], { message: 'direction must be asc or desc' })
  @IsOptional()
  direction: 'asc' | 'desc' = 'desc';
}
