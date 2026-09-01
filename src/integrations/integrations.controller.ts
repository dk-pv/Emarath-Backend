import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { IntegrationsService } from './integrations.service';
import {
  IntegrationResponse,
  UpdateIntegrationDto,
} from './dto/integration.dto';

/**
 * The integration library API (INT-01.1), under `/api/integrations`.
 *
 * Reading is open to any authenticated user — the library must render for everyone —
 * while enablement is `SUPERADMIN` only (ADR-0054 §6): enabling an integration changes
 * behaviour for every user of the instance, which is system configuration rather than
 * sales management. That is the server-side half of INT-02.2 AC5; the UI disabling the
 * control is the other half and cannot be relied on alone.
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  /** GET /api/integrations — the whole library in grid order. */
  @Get()
  list(): Promise<IntegrationResponse[]> {
    return this.service.list();
  }

  /** PATCH /api/integrations/:id — enable or disable one integration. */
  @Patch(':id')
  @Roles(UserRole.SUPERADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntegrationDto,
  ): Promise<IntegrationResponse> {
    return this.service.setEnabled(id, dto.enabled);
  }
}
