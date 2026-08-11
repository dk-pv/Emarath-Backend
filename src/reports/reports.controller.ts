import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NoActivityReportService } from './no-activity.service';
import { NoActivityQueryDto } from './dto/no-activity-query.dto';
import {
  NoActivityListResponse,
  NoActivitySummaryResponse,
} from './dto/no-activity-response.dto';

/**
 * The Reports module's HTTP surface (RPT-02.1). Thin by design: the DTO validates the
 * period/agent/source filters, the service owns the scoped query. All three routes are
 * static paths under `/api/reports/leads/no-activity`, so none collides with the others.
 */
@Controller('reports/leads/no-activity')
export class ReportsController {
  constructor(private readonly noActivity: NoActivityReportService) {}

  /** GET /api/reports/leads/no-activity — one scoped page of affected leads (detailed). */
  @Get()
  list(@Query() query: NoActivityQueryDto): Promise<NoActivityListResponse> {
    return this.noActivity.listDetailed(query);
  }

  /** GET /api/reports/leads/no-activity/summary — affected-lead counts per assignee. */
  @Get('summary')
  summary(
    @Query() query: NoActivityQueryDto,
  ): Promise<NoActivitySummaryResponse> {
    return this.noActivity.summary(query);
  }

  /** GET /api/reports/leads/no-activity/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: NoActivityQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.noActivity.exportCsv(query, res);
  }
}
