import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardKpisService } from './dashboard-kpis.service';
import { DashboardSummaryService } from './dashboard-summary.service';
import { SettingsModule } from '../settings/settings.module';
import { CallsModule } from '../calls/calls.module';
import { TeamRevenueService } from './team-revenue.service';
import { SalesLeaderboardService } from './sales-leaderboard.service';
import { CallActivityService } from './call-activity.service';
import { HotLeadsService } from './hot-leads.service';
import { LeadsAttentionService } from './leads-attention.service';
import { ActivitiesTrackerService } from './activities-tracker.service';
import { LeadSourceSummaryService } from './lead-source-summary.service';
import { LeadsConversionService } from './leads-conversion.service';
import { SalesPipelineService } from './sales-pipeline.service';

/**
 * The Dashboard module (Sprint 5). DASH-02.1 the KPI counters, DASH-03.1 the team
 * revenue rail, DASH-04.1 the sales leaderboard and DASH-05.1 the Call Activity
 * Board; the remaining widgets attach here as their own tasks land.
 *
 * It owns no business rules of its own — every figure is composed from the Leads,
 * Activities, Calls and Reports helpers. `CallsModule` is imported so the call
 * columns read the Call Dashboard's own aggregation rather than a second copy of
 * it; StorageService (global) mints the member avatars, and PrismaService and
 * CurrentUserService are global too.
 */
@Module({
  // The configured summary reads its card set from Application Controls; the
  // Calls module supplies the one shared per-agent call aggregation.
  imports: [SettingsModule, CallsModule],
  controllers: [DashboardController],
  providers: [
    DashboardKpisService,
    DashboardSummaryService,
    TeamRevenueService,
    SalesLeaderboardService,
    CallActivityService,
    HotLeadsService,
    LeadsAttentionService,
    ActivitiesTrackerService,
    LeadSourceSummaryService,
    LeadsConversionService,
    SalesPipelineService,
  ],
})
export class DashboardModule {}
