import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadAgingQueryDto } from './dto/lead-aging-query.dto';
import {
  LeadAgingListResponse,
  LeadAgingSummaryResponse,
} from './dto/lead-aging-response.dto';
import { LeadAgingReportService } from './lead-aging.service';

/**
 * The Lead Aging & Stale Leads report's read API (RPT-02.8). Every route is role-scoped by
 * the service through the shared `buildLeadWhere`, so a caller can only ever see leads
 * their scope already permits.
 */
@Controller('reports/leads/aging')
export class LeadAgingController {
  constructor(private readonly leadAging: LeadAgingReportService) {}

  /** GET /api/reports/leads/aging — one page of the Lead Aging Details table. */
  @Get()
  list(@Query() query: LeadAgingQueryDto): Promise<LeadAgingListResponse> {
    return this.leadAging.listDetailed(query);
  }

  /** GET /api/reports/leads/aging/summary — the metric cards and the agent breakdown. */
  @Get('summary')
  summary(
    @Query() query: LeadAgingQueryDto,
  ): Promise<LeadAgingSummaryResponse> {
    return this.leadAging.summary(query);
  }

  /** GET /api/reports/leads/aging/export — the scoped rows as a CSV download. */
  @Get('export')
  export(
    @Query() query: LeadAgingQueryDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    return this.leadAging.exportCsv(query, res);
  }
}
