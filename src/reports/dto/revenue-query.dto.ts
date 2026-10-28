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
import { normalizeFilterValues } from '../../leads/lead-filter';
import {
  DEFAULT_REPORT_PAGE_SIZE,
  MAX_FILTER_VALUES,
  MAX_REPORT_PAGE_SIZE,
} from './no-activity-query.dto';
import {
  REVENUE_GROUPS,
  REVENUE_SORTS,
  type RevenueGroup,
  type RevenueSort,
} from './revenue-response.dto';

/** A 31-day window's daily trend needs 32 edges; 62 leaves room for a long monthly one. */
export const MAX_TREND_EDGES = 62;

/** `Lead.pipeline` is `VarChar(64)`; a longer value can never match a row. */
const MAX_PIPELINE_LENGTH = 64;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const values = ({ value }: { value: unknown }): unknown =>
  normalizeFilterValues(value);

/**
 * The Revenue Report query (Analytics, ADR-0099 decision 15). Every window is a half-open
 * `[from, to)` pair of ISO instants the browser resolves in its own timezone, as for every other
 * report: `from`/`to` the reporting period, `priorFrom`/`priorTo` the one it is compared with,
 * `edge` the trend's bucket boundaries. `targetMonths` is how many whole calendar months the
 * period spans in that timezone — only the browser can tell — and absent when it is not whole
 * months. The overview, the Data Grid and the export all take this one query, so they never
 * describe different deals.
 */
export class RevenueQueryDto {
  @IsDateString({}, { message: 'from must be an ISO date' })
  @IsOptional()
  from?: string;

  @IsDateString({}, { message: 'to must be an ISO date' })
  @IsOptional()
  to?: string;

  @IsDateString({}, { message: 'priorFrom must be an ISO date' })
  @IsOptional()
  priorFrom?: string;

  @IsDateString({}, { message: 'priorTo must be an ISO date' })
  @IsOptional()
  priorTo?: string;

  /** The trend's bucket boundaries, ascending; n edges make n − 1 buckets. */
  @Transform(values)
  @IsArray({ message: 'edge must be one or more values' })
  @IsDateString({}, { each: true, message: 'each edge must be an ISO date' })
  @ArrayMaxSize(MAX_TREND_EDGES, {
    message: `edge accepts at most ${MAX_TREND_EDGES} values`,
  })
  @IsOptional()
  edge?: string[];

  @Type(() => Number)
  @IsInt({ message: 'targetMonths must be an integer' })
  @Min(1, { message: 'targetMonths must be 1 or greater' })
  @Max(120, { message: 'targetMonths must be at most 120' })
  @IsOptional()
  targetMonths?: number;

  /** Assigned-agent user ids — the toolbar's Sales Agent, matched through the assignment join. */
  @Transform(values)
  @IsArray({ message: 'agent must be one or more values' })
  @IsUUID('all', { each: true, message: 'each agent must be a valid id' })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `agent accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  agent?: string[];

  /** One exact board name; absent for every pipeline. */
  @Transform(trim)
  @IsString({ message: 'pipeline must be a string' })
  @MaxLength(MAX_PIPELINE_LENGTH, {
    message: `pipeline must be at most ${MAX_PIPELINE_LENGTH} characters`,
  })
  @IsOptional()
  pipeline?: string;

  /** The Filter condition builder's JSON payload, whitelisted by `parseLeadConditions`. */
  @IsString({ message: 'conditions must be a JSON string' })
  @MaxLength(8000, { message: 'conditions payload is too large' })
  @IsOptional()
  conditions?: string;

  @IsIn(REVENUE_GROUPS, {
    message: `group must be one of: ${REVENUE_GROUPS.join(', ')}`,
  })
  @IsOptional()
  group?: RevenueGroup;

  @IsIn(REVENUE_SORTS, {
    message: `sort must be one of: ${REVENUE_SORTS.join(', ')}`,
  })
  @IsOptional()
  sort?: RevenueSort;

  @IsIn(['asc', 'desc'], { message: 'direction must be asc or desc' })
  @IsOptional()
  direction?: 'asc' | 'desc';

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

  /** The export's header line, "Q4 2026 · All agents · All pipelines". Display only. */
  @Transform(trim)
  @IsString({ message: 'subtitle must be a string' })
  @MaxLength(200, { message: 'subtitle must be at most 200 characters' })
  @IsOptional()
  subtitle?: string;

  /** The export's names for the trend buckets ("Oct"), one per bucket. Display only. */
  @Transform(values)
  @IsArray({ message: 'label must be one or more values' })
  @IsString({ each: true, message: 'each label must be a string' })
  @MaxLength(40, {
    each: true,
    message: 'each label must be at most 40 characters',
  })
  @ArrayMaxSize(MAX_TREND_EDGES, {
    message: `label accepts at most ${MAX_TREND_EDGES} values`,
  })
  @IsOptional()
  label?: string[];
}
