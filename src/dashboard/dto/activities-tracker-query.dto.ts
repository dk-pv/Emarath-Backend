import { Type } from 'class-transformer';
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
  ACTIVITY_TRACKER_GROUPS,
  type ActivityTrackerGroup,
} from '../activities-tracker.service';

/**
 * The Dashboard Activities tracker query (DASH-09.2).
 *
 * `group` selects which bucket the table lists; all four counts come back
 * regardless, because all four cards are always on screen.
 *
 * The day and month edges are the caller's own local boundaries, sent as ISO
 * instants (ADR-0028 §3) — the same contract the Activities worklist uses, so
 * "today" and "this month" mean the user's day and month rather than the server's.
 * All five are required: every request returns every count, and a missing edge
 * would silently widen the one it belongs to.
 */
export class ActivitiesTrackerQueryDto {
  @IsIn(ACTIVITY_TRACKER_GROUPS, {
    message: `group must be one of: ${ACTIVITY_TRACKER_GROUPS.join(', ')}`,
  })
  @IsOptional()
  group: ActivityTrackerGroup = 'overdue';

  @IsDateString({}, { message: 'todayStart must be an ISO date' })
  todayStart!: string;

  @IsDateString({}, { message: 'todayEnd must be an ISO date' })
  todayEnd!: string;

  @IsDateString({}, { message: 'tomorrowEnd must be an ISO date' })
  tomorrowEnd!: string;

  @IsDateString({}, { message: 'monthStart must be an ISO date' })
  monthStart!: string;

  @IsDateString({}, { message: 'monthEnd must be an ISO date' })
  monthEnd!: string;

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
