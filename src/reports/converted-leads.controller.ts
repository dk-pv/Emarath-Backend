import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConvertedLeadsReportService } from './converted-leads.service';
import { ConvertedLeadsQueryDto } from './dto/converted-leads-query.dto';
import { ConvertedLeadsListResponse } from './dto/converted-leads-response.dto';

/**
 * The Converted Leads report's HTTP surface (RPT-02.6). Thin by design: the DTO validates the
 * period/agent/source filters, the service owns the scoped query. All three routes are static
 * paths under `/api/reports/leads/converted`, so none collides with the others.
 */
@Controller('reports/leads/converted')
export class ConvertedLeadsController {
  constructor(private readonly convertedLeads: ConvertedLeadsReportService) {}

  /** GET /api/reports/leads/converted — one scoped page of converted leads (detailed). */
  @Get()
  list(
    @Query() query: ConvertedLeadsQueryDto,
  ): Promise<ConvertedLeadsListResponse> {
    return this.convertedLeads.listDetailed(query);
  }

  /** GET /api/reports/leads/converted/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: ConvertedLeadsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.convertedLeads.exportCsv(query, res);
  }
}
