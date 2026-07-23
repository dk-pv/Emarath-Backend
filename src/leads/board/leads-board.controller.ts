import { Controller, Get, Query } from '@nestjs/common';
import { LeadsBoardService } from './leads-board.service';
import { BoardQueryDto, LeadBoardResponse } from './dto/board-query.dto';

/**
 * Kanban board data (KAN-02.1), under `/api/leads/board`. Its own static segment,
 * mirroring export/import, so it never collides with a `:id` route. Thin: the DTO
 * defaults/validates the pipeline, the service scopes and groups.
 */
@Controller('leads/board')
export class LeadsBoardController {
  constructor(private readonly service: LeadsBoardService) {}

  /** GET /api/leads/board?pipeline=Lead Pipeline — leads grouped by stage (KAN-02.1). */
  @Get()
  board(@Query() query: BoardQueryDto): Promise<LeadBoardResponse> {
    return this.service.board(query);
  }
}
