import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { SettingsService } from './settings.service';
import {
  SalesCrmGeneralSettings,
  UpdateSalesCrmGeneralDto,
} from './dto/sales-crm-general.dto';

/**
 * App-global Settings, under `/api/settings`.
 *
 * `SUPERADMIN` for the whole controller, reads included — matching `UsersController` and
 * `RolesController`. These settings are company policy: they decide what every user sees
 * (lead ordering, field labels) and what is hidden from them (mobile masking), so reading
 * them is as much an administrative act as changing them.
 *
 * Thin by design: the DTO validates, the service persists.
 */
@Controller('settings')
@Roles(UserRole.SUPERADMIN)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  /** GET /api/settings/sales-crm/general — the saved payload, or the shipped defaults. */
  @Get('sales-crm/general')
  getSalesCrmGeneral(): Promise<SalesCrmGeneralSettings> {
    return this.service.getSalesCrmGeneral();
  }

  /** PUT /api/settings/sales-crm/general — replaces the payload; returns what was stored. */
  @Put('sales-crm/general')
  saveSalesCrmGeneral(
    @Body() dto: UpdateSalesCrmGeneralDto,
  ): Promise<SalesCrmGeneralSettings> {
    return this.service.saveSalesCrmGeneral(dto);
  }
}
