import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { NoActivityReportService } from './no-activity.service';
import { TodayLeadsController } from './today-leads.controller';
import { TodayLeadsReportService } from './today-leads.service';
import { LeadsByStatusController } from './leads-by-status.controller';
import { LeadsByStatusReportService } from './leads-by-status.service';
import { LeadsBySourceController } from './leads-by-source.controller';
import { LeadsBySourceReportService } from './leads-by-source.service';

/**
 * The Reports feature (RPT-02.1: No Activity Leads; RPT-02.2: Today Leads; RPT-02.3: Leads By
 * Status; RPT-02.4: Leads By Source). PrismaService and CurrentUserService are global, and the
 * reports reuse the leads module's `buildLeadWhere` for scope/source/agent/period directly, so
 * no module imports are needed. Later report tasks (RPT-02.5+) add their services here.
 */
@Module({
  controllers: [
    ReportsController,
    TodayLeadsController,
    LeadsByStatusController,
    LeadsBySourceController,
  ],
  providers: [
    NoActivityReportService,
    TodayLeadsReportService,
    LeadsByStatusReportService,
    LeadsBySourceReportService,
  ],
})
export class ReportsModule {}
