import { Module } from '@nestjs/common';
import { StagesController } from './stages.controller';
import { StagesService } from './stages.service';

/**
 * Stage management (KAN-05.1). PrismaModule is global, so DB access resolves without
 * importing it. `StagesService` is exported so the board's drag-move can validate its
 * target against the one canonical catalogue (KAN-04.1) instead of a hard-coded list.
 */
@Module({
  controllers: [StagesController],
  providers: [StagesService],
  exports: [StagesService],
})
export class StagesModule {}
