import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { NoActivityReportService } from './no-activity.service';
import { TodayLeadsController } from './today-leads.controller';
import { TodayLeadsReportService } from './today-leads.service';

/**
 * The Reports feature (RPT-02.1: No Activity Leads; RPT-02.2: Today Leads). PrismaService and
 * CurrentUserService are global, and the reports reuse the leads module's `buildLeadWhere` for
 * scope/source/agent directly, so no module imports are needed. Later report tasks (RPT-02.3+)
 * add their services here.
 */
@Module({
  controllers: [ReportsController, TodayLeadsController],
  providers: [NoActivityReportService, TodayLeadsReportService],
})
export class ReportsModule {}
