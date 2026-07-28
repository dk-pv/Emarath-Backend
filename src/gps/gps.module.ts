import { Module } from '@nestjs/common';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';

/**
 * The GPS Map feature. GPS-01.1 landed the schema; GPS-02.1 adds the check-in /
 * check-out API and exports `GpsService` so the Activities completion gate
 * (ACT-10.1) can verify an on-site check-in. PrismaService (global) and
 * CurrentUserService (global, from AuthModule) are injected, so no imports are
 * needed. Passive tracking (GPS-03.1) and the map/list UI attach later.
 */
@Module({
  controllers: [GpsController],
  providers: [GpsService],
  exports: [GpsService],
})
export class GpsModule {}
