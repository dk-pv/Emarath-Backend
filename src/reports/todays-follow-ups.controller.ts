import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TodaysFollowUpsReportService } from './todays-follow-ups.service';
import { TodaysFollowUpsQueryDto } from './dto/todays-follow-ups-query.dto';
import { TodaysFollowUpsListResponse } from './dto/todays-follow-ups-response.dto';

/**
 * The Today's Follow Ups report's HTTP surface (RPT-03.1). Thin by design: the DTO validates the
 * day window and the agent/pipeline/type filters, the service owns the scoped query. The routes
 * are static paths under `/api/reports/follow-ups/today`, so none collides with the Overdue
 * report beside it or with the leads reports.
 */
@Controller('reports/follow-ups/today')
export class TodaysFollowUpsController {
  constructor(private readonly today: TodaysFollowUpsReportService) {}

  /** GET /api/reports/follow-ups/today — one scoped page of the follow-ups due today. */
  @Get()
  list(
    @Query() query: TodaysFollowUpsQueryDto,
  ): Promise<TodaysFollowUpsListResponse> {
    return this.today.list(query);
  }

  /** GET /api/reports/follow-ups/today/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: TodaysFollowUpsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.today.exportCsv(query, res);
  }
}
