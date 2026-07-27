import { Controller, Get, Query } from '@nestjs/common';
import { CallSummary, CallSummaryService } from './call-summary.service';
import {
  CallLeaderboardService,
  LeaderboardEntry,
} from './call-leaderboard.service';
import { CallLogResponse, CallLogService } from './call-log.service';
import { CallSummaryQueryDto } from './dto/call-summary-query.dto';
import { CallLogQueryDto } from './dto/call-log-query.dto';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('calls')
export class CallsController {
  constructor(
    private readonly summary: CallSummaryService,
    private readonly leaderboard: CallLeaderboardService,
    private readonly log: CallLogService,
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
}
