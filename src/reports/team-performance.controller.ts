import { Controller, Get, Query } from '@nestjs/common';
import { TeamPerformanceService } from './team-performance.service';
import {
  TeamPerformanceFilterOptions,
  TeamPerformanceQueryDto,
  TeamPerformanceResponse,
} from './dto/team-performance.dto';

/**
 * Team Performance (Teams v1), under `/api/reports/team-performance`. Like every other report, no
 * `@Roles()`: the sales roles reach it and the post-sale roles never do (RolesGuard), and what each
 * caller sees is decided in the service from their lead scope — the admin and the org-wide roles
 * every team, a Sales Manager their own team, a sales agent their own row.
 */
@Controller('reports/team-performance')
export class TeamPerformanceController {
  constructor(private readonly teamPerformance: TeamPerformanceService) {}

  /** GET /api/reports/team-performance — teams and BDEs compared over the filtered leads. */
  @Get()
  report(
    @Query() query: TeamPerformanceQueryDto,
  ): Promise<TeamPerformanceResponse> {
    return this.teamPerformance.report(query);
  }

  /** GET /api/reports/team-performance/filter-options — the teams, managers and BDEs offered. */
  @Get('filter-options')
  filterOptions(): Promise<TeamPerformanceFilterOptions> {
    return this.teamPerformance.filterOptions();
  }
}
