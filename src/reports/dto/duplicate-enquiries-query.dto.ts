import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
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
} from './no-activity-query.dto';

const MAX_VALUE_LENGTH = 120;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Duplicate Enquiries query (RPT-02.10): paging plus the toolbar's By Date, Assigned
 * To and Source filters. The filters define the population duplicates are judged within,
 * so narrowing the report genuinely changes which groups it finds.
 */
export class DuplicateEnquiriesQueryDto {
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

  /** The enquiry window's bounds — ISO instants the client computes in its own timezone. */
  @Transform(trim)
  @IsDateString({}, { message: 'from must be an ISO date' })
  @IsOptional()
  from?: string;

  @Transform(trim)
  @IsDateString({}, { message: 'to must be an ISO date' })
  @IsOptional()
  to?: string;

  /** Assigned-agent user ids (toolbar "Assigned To"). */
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

  /** Lead source values (toolbar "Source"). */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'source must be one or more values' })
  @IsString({ each: true, message: 'each source must be a string' })
  @MaxLength(MAX_VALUE_LENGTH, {
    each: true,
    message: `each source must be at most ${MAX_VALUE_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `source accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  source?: string[];
}
