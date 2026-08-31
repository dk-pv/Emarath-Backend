import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardKpisService } from './dashboard-kpis.service';

/**
 * The Dashboard module (Sprint 5). DASH-02.1 adds the KPI counters API; the
 * remaining widgets attach here as their own tasks land.
 *
 * It owns no business rules of its own — every counter is composed from the
 * Leads, Activities, Calls and Reports helpers, so PrismaService (global) and
 * CurrentUserService (global, from AuthModule) are the only injections needed.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardKpisService],
})
export class DashboardModule {}
