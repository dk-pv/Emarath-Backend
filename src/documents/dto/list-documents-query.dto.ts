import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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

/**
 * The file types the "All Documents" dropdown filters by (DOC-06.1), from
 * `documents-all-documents-dropdown-open-option-hover.png` — the same set the upload
 * policy allows (`STORAGE_ALLOWED_EXTENSIONS`), with `jpeg` folded into `jpg`. A
 * whitelist so an unknown value is a 400, never a passthrough into the query. The
 * match is on the file's own extension (what the "Type" column shows), not the stored
 * MIME, which is un-normalised browser input. (The reference's "Last Modified" entry
 * is deferred — its behaviour is not captured by any screenshot.)
 */
export const DOCUMENT_TYPE_FILTERS = [
  'xlsx',
  'png',
  'jpg',
  'pdf',
  'docx',
  'txt',
  'csv',
  'svg',
] as const;

export type DocumentTypeFilter = (typeof DOCUMENT_TYPE_FILTERS)[number];

export const DEFAULT_PAGE_SIZE = 25;

/** Guards the database against a caller asking for an unbounded page. */
export const MAX_PAGE_SIZE = 100;

/** A search longer than this is never a real query; reject it before the DB (matches Leads). */
export const MAX_SEARCH_LENGTH = 200;

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

  /** The active "All Documents" file-type filter; unset means every permitted document. */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(DOCUMENT_TYPE_FILTERS, {
    message: `type must be one of: ${DOCUMENT_TYPE_FILTERS.join(', ')}`,
  })
  @IsOptional()
  type?: DocumentTypeFilter;

  /**
   * Free-text search over the document name — the "File Name" column, i.e. `title`
   * (DOC-07.1). Trimmed here so a whitespace-only value arrives empty, which the search
   * builder treats as "no search" (AC5); length-capped before it can reach the database.
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
}
