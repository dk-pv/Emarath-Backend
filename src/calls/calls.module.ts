import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallLookupService } from './call-lookup.service';
import { CallSummaryService } from './call-summary.service';
import { CallLeaderboardService } from './call-leaderboard.service';
import { CallLogService } from './call-log.service';
import { CallAnalyticsService } from './call-analytics.service';

/**
 * The Call Dashboard feature. CALL-01.1 landed the schema; CALL-02.1 adds the
 * ingestion core (CallsService.ingest), CALL-02.2 the contact lookup
 * (CallLookupService) which ingestion consumes, CALL-03.1 the summary KPIs API
 * (GET /api/calls/summary), CALL-04.1 the leaderboard API
 * (GET /api/calls/leaderboard) and CALL-05.1 the Recent Call Log API
 * (GET /api/calls/log). The live 3CX transport and the log filters attach here
 * in later CALL tasks. PrismaService (global) and CurrentUserService (global,
 * from AuthModule) are injected, so no imports are needed. Services are exported
 * for the deferred transport and downstream reads.
 */
@Module({
  controllers: [CallsController],
  providers: [
    CallsService,
    CallLookupService,
    CallSummaryService,
    CallLeaderboardService,
    CallLogService,
    CallAnalyticsService,
  ],
  exports: [CallsService, CallLookupService],
})
export class CallsModule {}
