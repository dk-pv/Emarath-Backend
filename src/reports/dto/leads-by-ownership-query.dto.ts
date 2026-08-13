import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
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
import { MAX_TEAM_LENGTH } from './leads-by-status-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Leads By Ownership report query (RPT-02.5): paging plus the period/team filters (AC3) —
 * the same filter surface as Leads By Status/Source. `team` accepts repeated params
 * (`?team=Sales&team=Support`), coerced to a clean array (or dropped when blank) by the shared
 * `normalizeFilterValues`. `from`/`to` are ISO instants the client computes in its own timezone
 * (the creation window; `from` is the selected period, default "any time"). Validated before the
 * service runs, so an invalid request is a clean 400 with nothing queried.
 */
export class LeadsByOwnershipQueryDto {
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

  @Transform(trim)
  @IsDateString({}, { message: 'from must be an ISO date' })
  @IsOptional()
  from?: string;

  @Transform(trim)
  @IsDateString({}, { message: 'to must be an ISO date' })
  @IsOptional()
  to?: string;

  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'team must be one or more values' })
  @IsString({ each: true, message: 'each team must be a string' })
  @MaxLength(MAX_TEAM_LENGTH, {
    each: true,
    message: `each team must be at most ${MAX_TEAM_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `team accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  team?: string[];
}
