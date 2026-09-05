import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserService } from '../auth/current-user';
import { SettingsService } from './settings.service';
import {
  SalesCrmDuplicateSettings,
  UpdateSalesCrmDuplicateDto,
} from './dto/sales-crm-duplicate.dto';
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
  constructor(
    private readonly service: SettingsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** GET /api/settings/sales-crm/duplicate — the saved payload, or the shipped defaults. */
  @Get('sales-crm/duplicate')
  getSalesCrmDuplicate(): Promise<SalesCrmDuplicateSettings> {
    return this.service.getSalesCrmDuplicate();
  }

  /**
   * PUT /api/settings/sales-crm/duplicate — replaces the payload; returns what was
   * stored. The author of a change is resolved from the authenticated session, never
   * taken from the body.
   */
  @Put('sales-crm/duplicate')
  async saveSalesCrmDuplicate(
    @Body() dto: UpdateSalesCrmDuplicateDto,
  ): Promise<SalesCrmDuplicateSettings> {
    const actor = await this.currentUser.resolve();
    return this.service.saveSalesCrmDuplicate(dto, actor.id);
  }

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
