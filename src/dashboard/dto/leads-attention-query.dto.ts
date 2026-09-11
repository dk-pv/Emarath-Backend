import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../leads/dto/list-leads-query.dto';
import {
  ATTENTION_GROUPS,
  type AttentionGroup,
} from '../leads-attention.service';
import { DashboardPeriodQueryDto } from './dashboard-period-query.dto';

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The Leads – Need Attention query (DASH-07.1).
 *
 * `group` selects which bucket the table lists; the counts for all three come back
 * regardless, because all three cards are always on screen. `todayStart` is the
 * caller's own local midnight and is required for the same reason the KPI counters
 * require it — "overdue" is defined against the caller's today, not the server's
 * (ADR-0028 §3).
 */
export class LeadsAttentionQueryDto extends DashboardPeriodQueryDto {
  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'todayStart must be a valid date' })
  todayStart!: string;

  @IsIn(ATTENTION_GROUPS, {
    message: `group must be one of: ${ATTENTION_GROUPS.join(', ')}`,
  })
  group: AttentionGroup = 'overdue';

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
}
