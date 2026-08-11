import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { NoActivityReportService } from './no-activity.service';

/**
 * The Reports feature (RPT-02.1: No Activity Leads). PrismaService and CurrentUserService
 * are global, and the report reuses the leads module's `buildLeadWhere` for scope/source/agent
 * directly, so no module imports are needed. Later report tasks (RPT-02.2+) add their services
 * here.
 */
@Module({
  controllers: [ReportsController],
  providers: [NoActivityReportService],
})
export class ReportsModule {}
