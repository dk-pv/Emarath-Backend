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
import { HotLeadsResponse, HotLeadsService } from './hot-leads.service';
import { HotLeadsQueryDto } from './dto/hot-leads-query.dto';
import {
  LeadsAttentionResponse,
  LeadsAttentionService,
} from './leads-attention.service';
import { LeadsAttentionQueryDto } from './dto/leads-attention-query.dto';
import {
  ActivitiesTrackerResponse,
  ActivitiesTrackerService,
} from './activities-tracker.service';
import { ActivitiesTrackerQueryDto } from './dto/activities-tracker-query.dto';
import {
  LeadSourceSummary,
  LeadSourceSummaryService,
} from './lead-source-summary.service';
import { LeadSourceSummaryQueryDto } from './dto/lead-source-summary-query.dto';
import {
  LeadsConversion,
  LeadsConversionService,
} from './leads-conversion.service';
import { LeadsConversionQueryDto } from './dto/leads-conversion-query.dto';
import {
  SalesPipelineOverview,
  SalesPipelineService,
} from './sales-pipeline.service';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly kpis: DashboardKpisService,
    private readonly summary: DashboardSummaryService,
    private readonly teamRevenue: TeamRevenueService,
    private readonly salesLeaderboard: SalesLeaderboardService,
    private readonly callActivity: CallActivityService,
    private readonly hotLeads: HotLeadsService,
    private readonly leadsAttention: LeadsAttentionService,
    private readonly activitiesTracker: ActivitiesTrackerService,
    private readonly leadSourceSummary: LeadSourceSummaryService,
    private readonly leadsConversion: LeadsConversionService,
    private readonly salesPipeline: SalesPipelineService,
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

  /**
   * GET /api/dashboard/hot-leads — the Hot Leads widget (DASH-08.1): one page of
   * hot leads ranked by value, the role-scoped total, and the running total over
   * every hot lead in the period rather than just the page.
   */
  @Get('hot-leads')
  getHotLeads(@Query() query: HotLeadsQueryDto): Promise<HotLeadsResponse> {
    return this.hotLeads.getHotLeads(query);
  }

  /**
   * GET /api/dashboard/leads-attention — the at-risk board (DASH-07.1): counts for
   * Overdue / No Activity / Lost, plus one page of the selected group. Every group
   * is the predicate its own report already owns, so none of the three can drift
   * from the report it mirrors.
   */
  @Get('leads-attention')
  getLeadsAttention(
    @Query() query: LeadsAttentionQueryDto,
  ): Promise<LeadsAttentionResponse> {
    return this.leadsAttention.getLeadsAttention(query);
  }

  /**
   * GET /api/dashboard/activities — the Activities tracker's four counts plus the
   * selected bucket's page (DASH-09.2). Rows carry the worklist row shape, so the
   * Dashboard table reuses the Activities row actions unchanged.
   */
  @Get('activities')
  getActivities(
    @Query() query: ActivitiesTrackerQueryDto,
  ): Promise<ActivitiesTrackerResponse> {
    return this.activitiesTracker.getActivities(query);
  }

  /**
   * GET /api/dashboard/lead-source-summary — daily lead volume by acquisition
   * source for one widget's period (DASH-10.1), on the date dimension `mode`
   * selects: the lead's own creation date, or its assignment date.
   */
  @Get('lead-source-summary')
  getLeadSourceSummary(
    @Query() query: LeadSourceSummaryQueryDto,
  ): Promise<LeadSourceSummary> {
    return this.leadSourceSummary.getSummary(query);
  }

  /**
   * GET /api/dashboard/leads-conversion — leads and converted leads per category
   * for one widget's period (DASH-11.1), broken down by `breakdown`: the lead's
   * acquisition source, or the sales team member it is assigned to.
   */
  @Get('leads-conversion')
  getLeadsConversion(
    @Query() query: LeadsConversionQueryDto,
  ): Promise<LeadsConversion> {
    return this.leadsConversion.getLeadsConversion(query);
  }

  /**
   * GET /api/dashboard/sales-pipeline — every stage marked "Include In Sales
   * Pipeline", in configured order, with the leads sitting in it for one widget's
   * period (DASH-12.1). The counts are the Kanban board's own rollup.
   */
  @Get('sales-pipeline')
  getSalesPipeline(
    @Query() query: DashboardPeriodQueryDto,
  ): Promise<SalesPipelineOverview> {
    return this.salesPipeline.getOverview(query);
  }
}
