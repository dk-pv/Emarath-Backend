import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TodayLeadsReportService } from './today-leads.service';
import { TodayLeadsQueryDto } from './dto/today-leads-query.dto';
import {
  TodayLeadsListResponse,
  TodayLeadsSummaryResponse,
} from './dto/today-leads-response.dto';

/**
 * The Today Leads report's HTTP surface (RPT-02.2). Thin by design: the DTO validates the
 * period/agent/source filters, the service owns the scoped query. All three routes are
 * static paths under `/api/reports/leads/today`, so none collides with the others.
 */
@Controller('reports/leads/today')
export class TodayLeadsController {
  constructor(private readonly todayLeads: TodayLeadsReportService) {}

  /** GET /api/reports/leads/today — one scoped page of recently-contacted leads (detailed). */
  @Get()
  list(@Query() query: TodayLeadsQueryDto): Promise<TodayLeadsListResponse> {
    return this.todayLeads.listDetailed(query);
  }

  /** GET /api/reports/leads/today/summary — recently-contacted-lead counts per assignee. */
  @Get('summary')
  summary(
    @Query() query: TodayLeadsQueryDto,
  ): Promise<TodayLeadsSummaryResponse> {
    return this.todayLeads.summary(query);
  }

  /** GET /api/reports/leads/today/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: TodayLeadsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.todayLeads.exportCsv(query, res);
  }
}
