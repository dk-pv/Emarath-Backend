import { Controller, Get, Query } from '@nestjs/common';
import { DashboardKpis, DashboardKpisService } from './dashboard-kpis.service';
import { DashboardKpisQueryDto } from './dto/dashboard-kpis-query.dto';
import { DashboardPeriodQueryDto } from './dto/dashboard-period-query.dto';
import {
  DashboardSummary,
  DashboardSummaryService,
} from './dashboard-summary.service';
import { TeamRevenue, TeamRevenueService } from './team-revenue.service';
import {
  SalesLeaderboardEntry,
  SalesLeaderboardService,
} from './sales-leaderboard.service';
import { CallActivityPage, CallActivityService } from './call-activity.service';
import { CallActivityQueryDto } from './dto/call-activity-query.dto';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly kpis: DashboardKpisService,
    private readonly summary: DashboardSummaryService,
    private readonly teamRevenue: TeamRevenueService,
    private readonly salesLeaderboard: SalesLeaderboardService,
    private readonly callActivity: CallActivityService,
  ) {}

  /**
   * GET /api/dashboard/kpis — the top-of-dashboard counters for one widget's own
   * period (DASH-02.1). `counters` narrows the response to what a card needs;
   * omitting it returns all six.
   */
  @Get('kpis')
  getKpis(@Query() query: DashboardKpisQueryDto): Promise<DashboardKpis> {
    return this.kpis.getKpis(query);
  }

  /**
   * GET /api/dashboard/summary — the stage or source cards Settings → Application
   * Controls → Dashboard Settings configured, scoped to the caller. No role gate: the
   * dashboard is every user's landing page, and the rows are already scoped by
   * `leadScopeWhere`.
   */
  @Get('summary')
  getSummary(): Promise<DashboardSummary> {
    return this.summary.getSummary();
  }

  /**
   * GET /api/dashboard/team-revenue — the Sales Team Activity Board's left rail
   * (DASH-03.1): Total Leads, Total Calls, Total Conversion and % Revenue Target
   * Achieved for one widget's period, scoped by role.
   */
  @Get('team-revenue')
  getTeamRevenue(
    @Query() query: DashboardPeriodQueryDto,
  ): Promise<TeamRevenue> {
    return this.teamRevenue.getTeamRevenue(query);
  }

  /**
   * GET /api/dashboard/leaderboard — the per-agent sales cards beside it
   * (DASH-04.1). Both percentages may exceed 100 % and are null when they cannot
   * be computed, which the UI renders as NA.
   */
  @Get('leaderboard')
  getLeaderboard(
    @Query() query: DashboardPeriodQueryDto,
  ): Promise<SalesLeaderboardEntry[]> {
    return this.salesLeaderboard.getLeaderboard(query);
  }

  /**
   * GET /api/dashboard/call-activity — the Call Activity Board (DASH-05.1/05.2).
   * Reads the Call Dashboard's own aggregation, so the two surfaces cannot
   * disagree, and returns one page plus the role-scoped agent total.
   *
   * Takes `CallActivityQueryDto`, not the plain period query: the global validation
   * pipe whitelists unknown properties away, so declaring the narrower DTO here
   * would strip `page`/`size` and leave the paging silently inert.
   */
  @Get('call-activity')
  getCallActivity(
    @Query() query: CallActivityQueryDto,
  ): Promise<CallActivityPage> {
    return this.callActivity.getCallActivity(query);
  }
}
