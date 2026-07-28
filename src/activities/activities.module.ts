import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { GpsModule } from '../gps/gps.module';

/**
 * The Activities feature. ACT-01.1 landed the data model; ACT-03.1 adds the
 * create endpoint (POST /api/activities). List/edit/complete/delete attach here
 * in later ACT tasks. PrismaService (global) and CurrentUserService (global,
 * from AuthModule) are injected, so no imports are needed.
 */
@Module({
  imports: [GpsModule],
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
})
export class ActivitiesModule {}
