import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadsByStatusReportService } from './leads-by-status.service';
import { LeadsByStatusQueryDto } from './dto/leads-by-status-query.dto';
import {
  LeadsByStatusFilterOptions,
  LeadsByStatusListResponse,
  LeadsByStatusSummaryResponse,
} from './dto/leads-by-status-response.dto';

/**
 * The Leads By Status report's HTTP surface (RPT-02.3). Thin by design: the DTO validates the
 * period/team filters, the service owns the scoped query. All routes are static paths under
 * `/api/reports/leads/by-status`, so none collides with the others.
 */
@Controller('reports/leads/by-status')
export class LeadsByStatusController {
  constructor(private readonly leadsByStatus: LeadsByStatusReportService) {}

  /** GET /api/reports/leads/by-status — one scoped page of leads (detailed). */
  @Get()
  list(
    @Query() query: LeadsByStatusQueryDto,
  ): Promise<LeadsByStatusListResponse> {
    return this.leadsByStatus.listDetailed(query);
  }

  /** GET /api/reports/leads/by-status/summary — lead counts per status (+ chart data). */
  @Get('summary')
  summary(
    @Query() query: LeadsByStatusQueryDto,
  ): Promise<LeadsByStatusSummaryResponse> {
    return this.leadsByStatus.summary(query);
  }

  /** GET /api/reports/leads/by-status/filter-options — the team values the filter offers. */
  @Get('filter-options')
  filterOptions(): Promise<LeadsByStatusFilterOptions> {
    return this.leadsByStatus.filterOptions();
  }

  /** GET /api/reports/leads/by-status/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: LeadsByStatusQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.leadsByStatus.exportCsv(query, res);
  }
}
