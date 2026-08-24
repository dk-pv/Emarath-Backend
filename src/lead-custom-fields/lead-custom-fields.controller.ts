import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { LeadCustomFieldsService } from './lead-custom-fields.service';
import {
  CreateLeadCustomFieldDto,
  LeadCustomFieldDto,
} from './dto/lead-custom-field.dto';

/**
 * Custom-column definitions (LEAD-05.1, ADR-0051), under `/api/lead-custom-fields`.
 *
 * A top-level resource, deliberately NOT nested under `/leads/:id`, so it never
 * collides with the `GET /leads/:id` detail route. App-global (single-tenant): every
 * user shares one catalogue. Thin by design — the DTO validates, the service owns the
 * key derivation and uniqueness.
 */
@Controller('lead-custom-fields')
export class LeadCustomFieldsController {
  constructor(private readonly service: LeadCustomFieldsService) {}

  /** GET /api/lead-custom-fields — the active custom columns in display order. */
  @Get()
  list(): Promise<LeadCustomFieldDto[]> {
    return this.service.list();
  }

  /** POST /api/lead-custom-fields — create a custom column (name + type). */
  @Post()
  create(@Body() dto: CreateLeadCustomFieldDto): Promise<LeadCustomFieldDto> {
    return this.service.create(dto);
  }

  /** DELETE /api/lead-custom-fields/:id — soft-delete a custom column. */
  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.service.remove(id);
    return { id };
  }
}
