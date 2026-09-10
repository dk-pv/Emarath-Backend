import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../leads/dto/list-leads-query.dto';
import { DashboardPeriodQueryDto } from './dashboard-period-query.dto';

// The product has one set of paging bounds, declared with the Leads list and
// re-exported here so this endpoint cannot drift from every other list — the same
// import the Activities worklist DTO already makes.
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

/**
 * One page of the Call Activity Board (DASH-05.2).
 *
 * Its own class rather than two more fields on `DashboardPeriodQueryDto`: the team
 * revenue rail and the sales leaderboard share that DTO and return a fixed-size
 * result, so accepting `page`/`size` there would advertise paging they do not honour.
 */
export class CallActivityQueryDto extends DashboardPeriodQueryDto {
  /**
   * 1-based, matching what the pager shows. Left optional rather than defaulted
   * here (the Leads DTO's shape) because the service is what applies the default:
   * an absent bound must mean the same thing whichever DTO the route is declared
   * with, and this endpoint is also reachable with the plain period query.
   */
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be 1 or greater' })
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt({ message: 'size must be an integer' })
  @Min(1, { message: 'size must be 1 or greater' })
  @Max(MAX_PAGE_SIZE, { message: `size must be at most ${MAX_PAGE_SIZE}` })
  @IsOptional()
  size?: number;
}
