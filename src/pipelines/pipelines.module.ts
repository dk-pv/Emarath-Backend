import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';

/**
 * The sales pipeline catalogue. PrismaModule is global; AuthModule supplies the
 * `CurrentUserService` binding used to stamp a new pipeline's author. Nothing is
 * exported — `LookupsService` reads the table directly, as it does for stages,
 * tags and categories.
 */
@Module({
  imports: [AuthModule],
  controllers: [PipelinesController],
  providers: [PipelinesService],
})
export class PipelinesModule {}
