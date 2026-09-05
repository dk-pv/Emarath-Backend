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
import { LeadSourcesService } from './lead-sources.service';
import {
  CreateLeadSourceDto,
  LeadSourceNode,
  UpdateLeadSourceDto,
} from './dto/lead-source.dto';

/**
 * The lead source catalogue, under `/api/lead-sources`.
 *
 * `SUPERADMIN` for the whole controller, reads included — the same model every other
 * Settings screen uses (`CategoriesController`, `PipelinesController`, `RolesController`).
 * Agents still get the source options they need through `GET /api/lookups/sources`, which
 * reads this same table without exposing the management surface.
 *
 * Thin by design: the DTO validates, the service owns every rule.
 */
@Controller('lead-sources')
@Roles(UserRole.SUPERADMIN)
export class LeadSourcesController {
  constructor(private readonly service: LeadSourcesService) {}

  /** GET /api/lead-sources — the whole catalogue, in name order. */
  @Get()
  list(): Promise<LeadSourceNode[]> {
    return this.service.list();
  }

  /** POST /api/lead-sources — add a source, attributed to the caller. */
  @Post()
  create(@Body() dto: CreateLeadSourceDto): Promise<LeadSourceNode> {
    return this.service.create(dto);
  }

  /** PATCH /api/lead-sources/:id — rename (cascading to leads) and/or change status. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadSourceDto,
  ): Promise<LeadSourceNode> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/lead-sources/:id — refused while any lead carries the source. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
