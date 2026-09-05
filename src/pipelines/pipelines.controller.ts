import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PipelinesService } from './pipelines.service';
import {
  CreatePipelineDto,
  PipelineNode,
  UpdatePipelineDto,
} from './dto/pipeline.dto';

/**
 * The sales pipeline catalogue, under `/api/pipelines`.
 *
 * `SUPERADMIN` for the whole controller, reads included — the same model every other
 * Settings screen uses. Agents still get the pipeline options they need through
 * `GET /api/lookups/pipelines`, which reads this same table without exposing management.
 */
@Controller('pipelines')
@Roles(UserRole.SUPERADMIN)
export class PipelinesController {
  constructor(private readonly service: PipelinesService) {}

  /** GET /api/pipelines — the catalogue with lead counts, author and default flag. */
  @Get()
  list(): Promise<PipelineNode[]> {
    return this.service.list();
  }

  /** POST /api/pipelines — add a pipeline. */
  @Post()
  create(@Body() dto: CreatePipelineDto): Promise<PipelineNode> {
    return this.service.create(dto);
  }

  /**
   * PATCH /api/pipelines/:id/default — make this the default; returns the whole
   * catalogue, because the previous default changed too. Declared before `:id` so the
   * static segment is never captured as an update.
   */
  @Patch(':id/default')
  setDefault(@Param('id', ParseUUIDPipe) id: string): Promise<PipelineNode[]> {
    return this.service.setDefault(id);
  }

  /** PATCH /api/pipelines/:id — rename and/or re-code; a rename cascades. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipelineDto,
  ): Promise<PipelineNode> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/pipelines/:id — refused while it holds leads, or while it is default. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
