import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LostLeadsReportService } from './lost-leads.service';
import { LostLeadsQueryDto } from './dto/lost-leads-query.dto';
import {
  LostLeadsFilterOptions,
  LostLeadsListResponse,
  LostLeadsSummaryResponse,
} from './dto/lost-leads-response.dto';

/**
 * The Lost Leads report's HTTP surface (RPT-02.7). Thin by design: the DTO validates the
 * period/team filters, the service owns the scoped query. All routes are static paths under
 * `/api/reports/leads/lost`, so none collides with the others.
 */
@Controller('reports/leads/lost')
export class LostLeadsController {
  constructor(private readonly lostLeads: LostLeadsReportService) {}

  /** GET /api/reports/leads/lost — one scoped page of lost leads (detailed). */
  @Get()
  list(@Query() query: LostLeadsQueryDto): Promise<LostLeadsListResponse> {
    return this.lostLeads.listDetailed(query);
  }

  /** GET /api/reports/leads/lost/filter-options — the team values the filter offers. */
  /** GET /api/reports/leads/lost/summary — lost-lead counts per reason (AC1/AC2). */
  @Get('summary')
  summary(
    @Query() query: LostLeadsQueryDto,
  ): Promise<LostLeadsSummaryResponse> {
    return this.lostLeads.summary(query);
  }

  @Get('filter-options')
  filterOptions(): Promise<LostLeadsFilterOptions> {
    return this.lostLeads.filterOptions();
  }

  /** GET /api/reports/leads/lost/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: LostLeadsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.lostLeads.exportCsv(query, res);
  }
}
