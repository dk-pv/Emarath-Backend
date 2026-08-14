import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OverdueFollowUpsReportService } from './overdue-follow-ups.service';
import { OverdueFollowUpsQueryDto } from './dto/overdue-follow-ups-query.dto';
import {
  OverdueFollowUpsFilterOptions,
  OverdueFollowUpsListResponse,
  OverdueFollowUpsSummaryResponse,
} from './dto/overdue-follow-ups-response.dto';

/**
 * The Overdue Follow Ups report's HTTP surface (RPT-03.2). Thin by design: the DTO validates the
 * period/agent/team filters and the required `todayStart`, the service owns the scoped query. All
 * routes are static paths under `/api/reports/follow-ups/overdue`, so none collides with the leads
 * reports.
 */
@Controller('reports/follow-ups/overdue')
export class OverdueFollowUpsController {
  constructor(private readonly overdue: OverdueFollowUpsReportService) {}

  /** GET /api/reports/follow-ups/overdue — one scoped page of overdue follow-ups (detailed). */
  @Get()
  list(
    @Query() query: OverdueFollowUpsQueryDto,
  ): Promise<OverdueFollowUpsListResponse> {
    return this.overdue.listDetailed(query);
  }

  /** GET /api/reports/follow-ups/overdue/summary — overdue counts per assignee. */
  @Get('summary')
  summary(
    @Query() query: OverdueFollowUpsQueryDto,
  ): Promise<OverdueFollowUpsSummaryResponse> {
    return this.overdue.summary(query);
  }

  /** GET /api/reports/follow-ups/overdue/filter-options — the team values the filter offers. */
  @Get('filter-options')
  filterOptions(): Promise<OverdueFollowUpsFilterOptions> {
    return this.overdue.filterOptions();
  }

  /** GET /api/reports/follow-ups/overdue/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: OverdueFollowUpsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.overdue.exportCsv(query, res);
  }
}
