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

/**
 * The Reports feature (RPT-02.1: No Activity Leads; RPT-02.2: Today Leads; RPT-02.3: Leads By
 * Status; RPT-02.4: Leads By Source; RPT-02.5: Leads By Ownership; RPT-02.6: Converted Leads).
 * PrismaService and CurrentUserService are global, and the reports reuse the leads module's
 * `buildLeadWhere` for scope/source/agent/period directly, so no module imports are needed.
 * Later report tasks (RPT-02.7+) add their services here.
 */
@Module({
  controllers: [
    ReportsController,
    TodayLeadsController,
    LeadsByStatusController,
    LeadsBySourceController,
    LeadsByOwnershipController,
    ConvertedLeadsController,
  ],
  providers: [
    NoActivityReportService,
    TodayLeadsReportService,
    LeadsByStatusReportService,
    LeadsBySourceReportService,
    LeadsByOwnershipReportService,
    ConvertedLeadsReportService,
  ],
})
export class ReportsModule {}
