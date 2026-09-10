import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../leads/dto/list-leads-query.dto';
import { DashboardPeriodQueryDto } from './dashboard-period-query.dto';

/**
 * The Hot Leads widget's query (DASH-08.1): the widget's own period, plus the page.
 *
 * Extends the shared period DTO rather than restating `from`/`to`, and takes the
 * Leads list's own page bounds — a hot-lead set is a slice of the same 15,000-row
 * table, so the ceiling that guards it guards this too.
 */
export class HotLeadsQueryDto extends DashboardPeriodQueryDto {
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
