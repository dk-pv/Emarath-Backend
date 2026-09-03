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
import { ActivityType } from '../../generated/prisma/client';
import { normalizeFilterValues } from '../../leads/lead-filter';
import { MAX_FILTER_VALUE_LENGTH } from '../../leads/dto/list-leads-query.dto';
import {
  DEFAULT_REPORT_PAGE_SIZE,
  MAX_FILTER_VALUES,
  MAX_REPORT_PAGE_SIZE,
} from './no-activity-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const ACTIVITY_TYPES = Object.values(ActivityType);

/**
 * The Upcoming Follow Ups report query (RPT-03.3): paging, the required `todayEnd`
 * (the client's next local midnight — where "upcoming" starts), the By Date window over the due
 * date, and the agent/pipeline/type filters the toolbar offers. Repeated params (`?agent=…&agent=…`) are coerced to clean arrays
 * by the shared `normalizeFilterValues`. Validated before the service runs, so an invalid
 * request is a clean 400 with nothing queried.
 */
export class UpcomingFollowUpsQueryDto {
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
  @IsDateString({}, { message: 'todayEnd must be an ISO date' })
  todayEnd!: string;

  /** The By Date window over the due date — half-open, both edges optional. */
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
  @IsArray({ message: 'agent must be one or more values' })
  @IsUUID('all', { each: true, message: 'each agent must be a valid id' })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `agent accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  agent?: string[];

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
