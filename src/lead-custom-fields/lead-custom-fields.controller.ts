import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { LeadCustomFieldsService } from './lead-custom-fields.service';
import {
  CreateLeadCustomFieldDto,
  LeadCustomFieldDto,
  LeadCustomFieldPage,
  ListLeadCustomFieldsQueryDto,
  UpdateLeadCustomFieldDto,
} from './dto/lead-custom-field.dto';

/**
 * Custom-field definitions (LEAD-05.1 / ADR-0051, extended by Settings > Data & Schema
 * Management / ADR-0072), under `/api/lead-custom-fields`.
 *
 * A top-level resource, deliberately NOT nested under `/leads/:id`, so it never collides
 * with the `GET /leads/:id` detail route. App-global (single-tenant): every user shares
 * one catalogue. Thin by design — the DTO validates, the service owns the key derivation,
 * the option rules and the in-use guards.
 *
 * Roles are per-route on purpose. Reading the catalogue is what the Leads list and the
 * lead form do on every load, so it stays open to any signed-in user; **schema management
 * is administrative** and the settings routes are `SUPERADMIN`. `POST` keeps the access it
 * shipped with (the Leads "Add Column" flow, LEAD-05.1) — tightening it would remove a
 * capability agents already have, which is a LEAD-05.1 decision rather than this task's.
 */
@Controller('lead-custom-fields')
export class LeadCustomFieldsController {
  constructor(private readonly service: LeadCustomFieldsService) {}

  /** GET /api/lead-custom-fields — the active custom columns in display order. */
  @Get()
  list(): Promise<LeadCustomFieldDto[]> {
    return this.service.list();
  }

  /**
   * GET /api/lead-custom-fields/page — the Settings list: searched, type-filtered, paged.
   * A static segment, so it cannot be read as an id.
   */
  @Get('page')
  @Roles(UserRole.SUPERADMIN)
  page(
    @Query() query: ListLeadCustomFieldsQueryDto,
  ): Promise<LeadCustomFieldPage> {
    return this.service.page(query);
  }

  /** POST /api/lead-custom-fields — create a custom field (label + type + options). */
  @Post()
  create(@Body() dto: CreateLeadCustomFieldDto): Promise<LeadCustomFieldDto> {
    return this.service.create(dto);
  }

  /** PATCH /api/lead-custom-fields/:id — edit the label, status, type and options. */
  @Patch(':id')
  @Roles(UserRole.SUPERADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadCustomFieldDto,
  ): Promise<LeadCustomFieldDto> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/lead-custom-fields/:id — soft-delete a field nothing has been filed under. */
  @Delete(':id')
  @Roles(UserRole.SUPERADMIN)
  @HttpCode(200)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.service.remove(id);
    return { id };
  }
}
