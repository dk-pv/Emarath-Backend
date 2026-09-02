import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadFirstResponseQueryDto } from './dto/lead-first-response-query.dto';
import {
  LeadFirstResponseListResponse,
  LeadFirstResponseSummaryResponse,
} from './dto/lead-first-response-response.dto';
import { LeadFirstResponseService } from './lead-first-response.service';

/**
 * The Lead First Response report's read API (RPT-02.9). Every route is role-scoped by the
 * service through the shared `buildLeadWhere`, so a caller only ever sees leads their
 * scope already permits.
 */
@Controller('reports/leads/first-response')
export class LeadFirstResponseController {
  constructor(private readonly firstResponse: LeadFirstResponseService) {}

  /** GET /api/reports/leads/first-response — one page of the Lead Records table. */
  @Get()
  list(
    @Query() query: LeadFirstResponseQueryDto,
  ): Promise<LeadFirstResponseListResponse> {
    return this.firstResponse.listDetailed(query);
  }

  /** GET /api/reports/leads/first-response/summary — the metric cards and tab counts. */
  @Get('summary')
  summary(
    @Query() query: LeadFirstResponseQueryDto,
  ): Promise<LeadFirstResponseSummaryResponse> {
    return this.firstResponse.summary(query);
  }

  /** GET /api/reports/leads/first-response/export — the scoped rows as a CSV download. */
  @Get('export')
  export(
    @Query() query: LeadFirstResponseQueryDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    return this.firstResponse.exportCsv(query, res);
  }
}
