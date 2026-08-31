import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CallSummary, CallSummaryService } from './call-summary.service';
import {
  CallLeaderboardService,
  LeaderboardEntry,
} from './call-leaderboard.service';
import { CallLogResponse, CallLogService } from './call-log.service';
import { CallAnalytics, CallAnalyticsService } from './call-analytics.service';
import { CallSummaryQueryDto } from './dto/call-summary-query.dto';
import { CallLogQueryDto } from './dto/call-log-query.dto';
import { FlagCallDto } from './dto/flag-call.dto';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('calls')
export class CallsController {
  constructor(
    private readonly summary: CallSummaryService,
    private readonly leaderboard: CallLeaderboardService,
    private readonly log: CallLogService,
    private readonly analytics: CallAnalyticsService,
  ) {}

  /** GET /api/calls/summary — the six day-level KPIs for the period (CALL-03.1). */
  @Get('summary')
  getSummary(@Query() query: CallSummaryQueryDto): Promise<CallSummary> {
    return this.summary.getSummary(query);
  }

  /** GET /api/calls/leaderboard — agents ranked by call volume/quality (CALL-04.1). */
  @Get('leaderboard')
  getLeaderboard(
    @Query() query: CallSummaryQueryDto,
  ): Promise<LeaderboardEntry[]> {
    return this.leaderboard.getLeaderboard(query);
  }

  /** GET /api/calls/log — the scoped, paginated Recent Call Log (CALL-05.1). */
  @Get('log')
  getLog(@Query() query: CallLogQueryDto): Promise<CallLogResponse> {
    return this.log.getLog(query);
  }

  /**
   * GET /api/calls/analytics — the Call By Status, Lead Source and Lead Stage
   * panels, over the same scoped window as the KPIs above them.
   */
  @Get('analytics')
  getAnalytics(@Query() query: CallSummaryQueryDto): Promise<CallAnalytics> {
    return this.analytics.getAnalytics(query);
  }

  /** PATCH /api/calls/:id/flag — the log's Flag row action. */
  @Patch(':id/flag')
  setFlagged(
    @Param('id') id: string,
    @Body() body: FlagCallDto,
  ): Promise<{ flagged: boolean }> {
    return this.log.setFlagged(id, body.flagged);
  }
}
