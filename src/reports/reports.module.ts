import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { NoActivityReportService } from './no-activity.service';
import { TodayLeadsController } from './today-leads.controller';
import { TodayLeadsReportService } from './today-leads.service';
import { LeadsByStatusController } from './leads-by-status.controller';
import { LeadsByStatusReportService } from './leads-by-status.service';

/**
 * The Reports feature (RPT-02.1: No Activity Leads; RPT-02.2: Today Leads; RPT-02.3: Leads By
 * Status). PrismaService and CurrentUserService are global, and the reports reuse the leads
 * module's `buildLeadWhere` for scope/source/agent/period directly, so no module imports are
 * needed. Later report tasks (RPT-02.4+) add their services here.
 */
@Module({
  controllers: [
    ReportsController,
    TodayLeadsController,
    LeadsByStatusController,
  ],
  providers: [
    NoActivityReportService,
    TodayLeadsReportService,
    LeadsByStatusReportService,
  ],
})
export class ReportsModule {}
