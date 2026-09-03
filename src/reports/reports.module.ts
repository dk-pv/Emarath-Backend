import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { NoActivityReportService } from './no-activity.service';
import { TodayLeadsController } from './today-leads.controller';
import { TodayLeadsReportService } from './today-leads.service';
import { LeadsByStatusController } from './leads-by-status.controller';
import { LeadsByStatusReportService } from './leads-by-status.service';
import { LeadsBySourceController } from './leads-by-source.controller';
import { LeadsBySourceReportService } from './leads-by-source.service';
import { LeadsByOwnershipController } from './leads-by-ownership.controller';
import { LeadsByOwnershipReportService } from './leads-by-ownership.service';
import { ConvertedLeadsController } from './converted-leads.controller';
import { ConvertedLeadsReportService } from './converted-leads.service';
import { LeadAgingController } from './lead-aging.controller';
import { DuplicateEnquiriesController } from './duplicate-enquiries.controller';
import { DuplicateEnquiriesService } from './duplicate-enquiries.service';
import { LeadFirstResponseController } from './lead-first-response.controller';
import { LeadFirstResponseService } from './lead-first-response.service';
import { LeadAgingReportService } from './lead-aging.service';
import { LostLeadsController } from './lost-leads.controller';
import { LostLeadsReportService } from './lost-leads.service';
import { OverdueFollowUpsController } from './overdue-follow-ups.controller';
import { TodaysFollowUpsController } from './todays-follow-ups.controller';
import { UpcomingFollowUpsController } from './upcoming-follow-ups.controller';
import { UpcomingFollowUpsReportService } from './upcoming-follow-ups.service';
import { TodaysFollowUpsReportService } from './todays-follow-ups.service';
import { OverdueFollowUpsReportService } from './overdue-follow-ups.service';

/**
 * The Reports feature (RPT-02.1: No Activity Leads; RPT-02.2: Today Leads; RPT-02.3: Leads By
 * Status; RPT-02.4: Leads By Source; RPT-02.5: Leads By Ownership; RPT-02.6: Converted Leads;
 * RPT-02.7: Lost Leads; RPT-03.2: Overdue Follow Ups; RPT-03.1: Today's Follow Ups; RPT-03.3: Upcoming Follow Ups). PrismaService and CurrentUserService are
 * global; the leads reports reuse the leads module's `buildLeadWhere` and the follow-up reports
 * reuse the activities module's scope/bucket helpers directly (pure functions), so no module
 * imports are needed. Later report tasks add their services here.
 */
@Module({
  controllers: [
    ReportsController,
    TodayLeadsController,
    LeadsByStatusController,
    LeadsBySourceController,
    LeadsByOwnershipController,
    ConvertedLeadsController,
    LostLeadsController,
    LeadAgingController,
    LeadFirstResponseController,
    DuplicateEnquiriesController,
    OverdueFollowUpsController,
    TodaysFollowUpsController,
    UpcomingFollowUpsController,
  ],
  providers: [
    NoActivityReportService,
    TodayLeadsReportService,
    LeadsByStatusReportService,
    LeadsBySourceReportService,
    LeadsByOwnershipReportService,
    ConvertedLeadsReportService,
    LostLeadsReportService,
    LeadAgingReportService,
    LeadFirstResponseService,
    DuplicateEnquiriesService,
    OverdueFollowUpsReportService,
    TodaysFollowUpsReportService,
    UpcomingFollowUpsReportService,
  ],
})
export class ReportsModule {}
