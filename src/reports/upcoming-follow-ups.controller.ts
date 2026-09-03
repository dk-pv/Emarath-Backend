import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UpcomingFollowUpsReportService } from './upcoming-follow-ups.service';
import { UpcomingFollowUpsQueryDto } from './dto/upcoming-follow-ups-query.dto';
import { UpcomingFollowUpsListResponse } from './dto/upcoming-follow-ups-response.dto';

/**
 * The Upcoming Follow Ups report's HTTP surface (RPT-03.3). Thin by design: the DTO validates the
 * upcoming floor, the By Date window and the agent/pipeline/type filters, the service owns the scoped query. The routes
 * are static paths under `/api/reports/follow-ups/upcoming`, so none collides with the Overdue and Today reports beside it or with the leads reports.
 */
@Controller('reports/follow-ups/upcoming')
export class UpcomingFollowUpsController {
  constructor(private readonly upcoming: UpcomingFollowUpsReportService) {}

  /** GET /api/reports/follow-ups/upcoming — one scoped page of the follow-ups due
   * from tomorrow onward. */
  @Get()
  list(
    @Query() query: UpcomingFollowUpsQueryDto,
  ): Promise<UpcomingFollowUpsListResponse> {
    return this.upcoming.list(query);
  }

  /** GET /api/reports/follow-ups/upcoming/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: UpcomingFollowUpsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.upcoming.exportCsv(query, res);
  }
}
