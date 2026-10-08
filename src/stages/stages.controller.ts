import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../generated/prisma/client';
import { StagesService } from './stages.service';
import {
  CreateStageDto,
  ReorderStagesDto,
  StageListQueryDto,
  StageResponse,
  UpdateStageDto,
} from './dto/stage.dto';

/**
 * Stage management (KAN-05.1), under `/api/stages` — the only write path for the stage
 * catalogue. `reorder` is declared before `:id` so the static segment wins over the
 * UUID param route; every `:id` is UUID-guarded at the edge.
 *
 * Reading the catalogue is open to every sales role (the board and every status badge
 * need it); changing it is for admins and sales managers only (KAN-05.2 AC5, owner
 * decision 2026-10-07): a rename relabels every lead in the stage, including leads the
 * caller cannot see, so it is never a per-agent action.
 */
@Controller('stages')
export class StagesController {
  constructor(private readonly service: StagesService) {}

  /** GET /api/stages?pipeline=… — a pipeline's stages in order (AC4). */
  @Get()
  list(@Query() query: StageListQueryDto): Promise<StageResponse[]> {
    return this.service.list(query.pipeline);
  }

  /** POST /api/stages — add a stage (AC1). */
  @Post()
  @Roles(UserRole.SUPERADMIN, UserRole.SALES_MANAGER)
  create(@Body() dto: CreateStageDto): Promise<StageResponse> {
    return this.service.create(dto);
  }

  /** PATCH /api/stages/reorder — persist a new stage order (AC3). */
  @Patch('reorder')
  @Roles(UserRole.SUPERADMIN, UserRole.SALES_MANAGER)
  reorder(@Body() dto: ReorderStagesDto): Promise<StageResponse[]> {
    return this.service.reorder(dto);
  }

  /** PATCH /api/stages/:id — rename and/or recolour a stage (AC2). */
  @Patch(':id')
  @Roles(UserRole.SUPERADMIN, UserRole.SALES_MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStageDto,
  ): Promise<StageResponse> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/stages/:id — remove a stage, if no lead sits in it (AC5). */
  @Delete(':id')
  @Roles(UserRole.SUPERADMIN, UserRole.SALES_MANAGER)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
