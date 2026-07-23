import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { LeadsBoardService } from './leads-board.service';
import { MoveLeadStageDto, MoveLeadStageResponse } from './dto/move-stage.dto';

/**
 * The Kanban stage change (KAN-04.1), under `PATCH /api/leads/:id/stage`.
 *
 * PATCH, not the row actions' POST: dropping a card onto a column sets the lead's
 * stage (its `status`) — a field update, idempotent, not a command. The `:id` is
 * UUID-guarded at the edge, so a malformed id is a 400 before any query runs. A
 * separate controller from `leads/board`'s GET keeps that a pure read surface.
 */
@Controller('leads')
export class LeadStageController {
  constructor(private readonly service: LeadsBoardService) {}

  /** PATCH /api/leads/:id/stage — move this lead to a new Kanban stage (KAN-04.1). */
  @Patch(':id/stage')
  moveStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveLeadStageDto,
  ): Promise<MoveLeadStageResponse> {
    return this.service.moveStage(id, dto);
  }
}
