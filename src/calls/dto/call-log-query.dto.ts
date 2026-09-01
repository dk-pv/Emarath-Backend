import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CallOutcome } from '../../generated/prisma/client';

export const DEFAULT_LOG_PAGE_SIZE = 20;
/** Never return an unbounded call log (CLAUDE §8 — the 15k-row rule). */
export const MAX_LOG_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 200;

/**
 * The Recent Call Log query (CALL-05.1). Period reuses the summary's `from`/`to`
 * (resolved by `resolvePeriod`, default Today); `outcome` is the tab filter and
 * `search` matches name or number (AC4). The remaining "additional filters"
 * (lead status, agent, date range, and the Change-Request gaps) are CALL-06.1.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The reference's Time Metric: which measure the log is ordered by. Both read
 * columns the Call already stores — no new concept, and `CALL_TIMING` is the
 * existing default ordering under its product name.
 */
export const TIME_METRICS = ['CALL_TIMING', 'CALL_DURATION'] as const;
export type TimeMetric = (typeof TIME_METRICS)[number];

/** A query string carries "true"/"false", not a boolean. */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value === '' || value === undefined ? undefined : value;
};

export class CallLogQueryDto {
  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'from must be a valid date' })
  @IsOptional()
  from?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'to must be a valid date' })
  @IsOptional()
  to?: string;

  /** 1-based, matching what the pager shows. */
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be 1 or greater' })
  @IsOptional()
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'size must be an integer' })
  @Min(1, { message: 'size must be 1 or greater' })
  @Max(MAX_LOG_PAGE_SIZE, {
    message: `size must be at most ${MAX_LOG_PAGE_SIZE}`,
  })
  @IsOptional()
  size: number = DEFAULT_LOG_PAGE_SIZE;

  /** The tab filter — All (omitted), Answered, No answer, Busy. */
  @IsEnum(CallOutcome, {
    message: 'outcome must be ANSWERED, NO_ANSWER or BUSY',
  })
  @IsOptional()
  outcome?: CallOutcome;

  /** Search by lead name or phone number. */
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  @IsOptional()
  search?: string;

  /** Lead Status filter (CALL-06.1); matches the lead's status. VarChar(64). */
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  leadStatus?: string;

  /** Agent filter (CALL-06.1) — narrows to one call agent. */
  @Transform(emptyToUndefined)
  @IsUUID('4', { message: 'agentId must be a valid id' })
  @IsOptional()
  agentId?: string;

  /** Time Metric — orders the log by call timing (default) or by duration. */
  @Transform(emptyToUndefined)
  @IsIn(TIME_METRICS, {
    message: 'timeMetric must be CALL_TIMING or CALL_DURATION',
  })
  @IsOptional()
  timeMetric?: TimeMetric;

  /** "Show flagged calls only" — restricts the page to flagged attempts. */
  @Transform(toBoolean)
  @IsBoolean({ message: 'flagged must be true or false' })
  @IsOptional()
  flagged?: boolean;
}
