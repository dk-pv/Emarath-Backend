import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
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
}
