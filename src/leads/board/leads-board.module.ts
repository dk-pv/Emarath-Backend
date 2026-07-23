import { Module } from '@nestjs/common';
import { StagesModule } from '../../stages/stages.module';
import { LeadsBoardController } from './leads-board.controller';
import { LeadStageController } from './lead-stage.controller';
import { LeadsBoardService } from './leads-board.service';

/**
 * Kanban board data (KAN-02.1) and the card-drag stage change (KAN-04.1).
 * PrismaModule and AuthModule are global, so DB access and the caller resolve
 * without importing either — one folder per Leads capability, mirroring
 * bulk/import/export/row-actions/tags. `StagesModule` supplies the canonical
 * catalogue the move validates its target against (KAN-05.1). Both controllers
 * share the one service.
 */
@Module({
  imports: [StagesModule],
  controllers: [LeadsBoardController, LeadStageController],
  providers: [LeadsBoardService],
})
export class LeadsBoardModule {}
