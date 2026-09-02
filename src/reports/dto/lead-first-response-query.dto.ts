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

const MAX_VALUE_LENGTH = 120;

/**
 * The activity kinds the toolbar filter offers, in the reference's own vocabulary. Each
 * maps to a record Emarath actually keeps against a lead:
 *
 *   CALL           a logged call, or an activity of kind CALL
 *   NOTE           a lead note
 *   FOLLOW_UP      an activity (the follow-up module)
 *   STATUS_CHANGED the lead's status has moved since it was created
 *   LEAD_EDITED    the lead has been written to since it was created
 *
 * "Email" is deliberately absent: nothing in the model records a sent email, so the
 * option could only ever return an empty list.
 */
export const ACTIVITY_TYPES = [
  'CALL',
  'NOTE',
  'FOLLOW_UP',
  'STATUS_CHANGED',
  'LEAD_EDITED',
] as const;

/** Which slice of the records the tabs are showing. */
export const CONTACT_FILTERS = ['all', 'contacted', 'untouched'] as const;

/** "Responded late" is anything past this many hours; the reference's default is 24. */
export const DEFAULT_LATE_HOURS = 24;
export const MAX_LATE_HOURS = 720;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Lead First Response query (RPT-02.9): paging, the toolbar's search/agent/source/
 * activity-type filters, the creation window, which records tab is active, the late
 * threshold the cards count against, and the details table's sort.
 */
export class LeadFirstResponseQueryDto {
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

  /** Free-text search over the lead, exactly as the Leads list matches it. */
  @Transform(trim)
  @IsString({ message: 'search must be a string' })
  @MaxLength(MAX_VALUE_LENGTH, {
    message: `search must be at most ${MAX_VALUE_LENGTH} characters`,
  })
  @IsOptional()
  search?: string;

  @Transform(trim)
  @IsDateString({}, { message: 'from must be an ISO date' })
  @IsOptional()
  from?: string;

  @Transform(trim)
  @IsDateString({}, { message: 'to must be an ISO date' })
  @IsOptional()
  to?: string;

  /** Assigned-agent user ids (toolbar "Sales Agent"). */
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

  /** Lead source values (toolbar "All Sources"). */
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

  /** Narrows to leads carrying an activity of these kinds (toolbar "Activity Type"). */
  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'activityType must be one or more values' })
  @IsIn(ACTIVITY_TYPES as unknown as string[], {
    each: true,
    message: `each activityType must be one of ${ACTIVITY_TYPES.join(', ')}`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `activityType accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  activityType?: string[];

  /** Which records tab is active: every lead, only contacted, or only untouched. */
  @Transform(trim)
  @IsIn(CONTACT_FILTERS as unknown as string[], {
    message: `contact must be one of ${CONTACT_FILTERS.join(', ')}`,
  })
  @IsOptional()
  contact?: (typeof CONTACT_FILTERS)[number];

  /** The "Responded > N hrs" bound the cards count against (Report Settings). */
  @Type(() => Number)
  @IsInt({ message: 'lateHours must be an integer' })
  @Min(1, { message: 'lateHours must be 1 or greater' })
  @Max(MAX_LATE_HOURS, {
    message: `lateHours must be at most ${MAX_LATE_HOURS}`,
  })
  @IsOptional()
  lateHours: number = DEFAULT_LATE_HOURS;

  /** Which column the records table is ordered by; unknown keys fall back to the default. */
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
