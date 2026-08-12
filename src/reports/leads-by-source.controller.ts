import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadsBySourceReportService } from './leads-by-source.service';
import { LeadsBySourceQueryDto } from './dto/leads-by-source-query.dto';
import {
  LeadsBySourceFilterOptions,
  LeadsBySourceListResponse,
  LeadsBySourceSummaryResponse,
} from './dto/leads-by-source-response.dto';

/**
 * The Leads By Source report's HTTP surface (RPT-02.4). Thin by design: the DTO validates the
 * period/team filters, the service owns the scoped query. All routes are static paths under
 * `/api/reports/leads/by-source`, so none collides with the others.
 */
@Controller('reports/leads/by-source')
export class LeadsBySourceController {
  constructor(private readonly leadsBySource: LeadsBySourceReportService) {}

  /** GET /api/reports/leads/by-source — one scoped page of leads (detailed). */
  @Get()
  list(
    @Query() query: LeadsBySourceQueryDto,
  ): Promise<LeadsBySourceListResponse> {
    return this.leadsBySource.listDetailed(query);
  }

  /** GET /api/reports/leads/by-source/summary — lead counts per source (+ chart data). */
  @Get('summary')
  summary(
    @Query() query: LeadsBySourceQueryDto,
  ): Promise<LeadsBySourceSummaryResponse> {
    return this.leadsBySource.summary(query);
  }

  /** GET /api/reports/leads/by-source/filter-options — the team values the filter offers. */
  @Get('filter-options')
  filterOptions(): Promise<LeadsBySourceFilterOptions> {
    return this.leadsBySource.filterOptions();
  }

  /** GET /api/reports/leads/by-source/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: LeadsBySourceQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.leadsBySource.exportCsv(query, res);
  }
}
