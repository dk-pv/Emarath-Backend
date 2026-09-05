import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserService } from '../auth/current-user';
import { SettingsService } from './settings.service';
import {
  SalesCrmDuplicateSettings,
  UpdateSalesCrmDuplicateDto,
} from './dto/sales-crm-duplicate.dto';
import {
  OrganizationGeneralSettings,
  UpdateOrganizationGeneralDto,
} from './dto/organization-general.dto';
import {
  OrganizationCompanyDetails,
  UpdateOrganizationCompanyDto,
} from './dto/organization-company.dto';
import {
  CreateHostDomainDto,
  OrganizationHostMapping,
} from './dto/organization-host-mapping.dto';
import {
  CommunicationAlertsSettings,
  UpdateCommunicationAlertsDto,
} from './dto/communication-alerts.dto';
import {
  AssignmentGeneralSettings,
  UpdateAssignmentGeneralDto,
} from './dto/assignment-general.dto';
import {
  CallStatusRow,
  CallTrackingGeneralSettings,
  UpdateCallStatusDto,
  UpdateCallTrackingGeneralDto,
} from './dto/call-tracking.dto';
import {
  SalesCrmGeneralSettings,
  UpdateSalesCrmGeneralDto,
} from './dto/sales-crm-general.dto';
import {
  ActivityGeneralSettings,
  ActivityWorkflowSettings,
  FollowUpType,
  SaveFollowUpTypeDto,
  UpdateActivityGeneralDto,
} from './dto/activity-reminders.dto';

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

  /** GET /api/settings/organization/general — the saved payload, or the defaults. */
  @Get('organization/general')
  getOrganizationGeneral(): Promise<OrganizationGeneralSettings> {
    return this.service.getOrganizationGeneral();
  }

  /** PUT /api/settings/organization/general — replaces the payload; returns what was stored. */
  @Put('organization/general')
  saveOrganizationGeneral(
    @Body() dto: UpdateOrganizationGeneralDto,
  ): Promise<OrganizationGeneralSettings> {
    return this.service.saveOrganizationGeneral(dto);
  }

  /** GET /api/settings/organization/company-details — the saved payload, or a blank record. */
  @Get('organization/company-details')
  getOrganizationCompany(): Promise<OrganizationCompanyDetails> {
    return this.service.getOrganizationCompany();
  }

  /** PUT /api/settings/organization/company-details — replaces the payload; returns what was stored. */
  @Put('organization/company-details')
  saveOrganizationCompany(
    @Body() dto: UpdateOrganizationCompanyDto,
  ): Promise<OrganizationCompanyDetails> {
    return this.service.saveOrganizationCompany(dto);
  }

  /** GET /api/settings/organization/host-mapping — the mapped domains, newest last. */
  @Get('organization/host-mapping')
  getOrganizationHostMapping(): Promise<OrganizationHostMapping> {
    return this.service.getOrganizationHostMapping();
  }

  /**
   * POST /api/settings/organization/host-mapping/domains — adds one domain and returns
   * the whole list, so one Save is one request and the screen redraws from the response.
   */
  @Post('organization/host-mapping/domains')
  addHostDomain(
    @Body() dto: CreateHostDomainDto,
  ): Promise<OrganizationHostMapping> {
    return this.service.addHostDomain(dto);
  }

  /** DELETE /api/settings/organization/host-mapping/domains/:id — returns what is left. */
  @Delete('organization/host-mapping/domains/:id')
  deleteHostDomain(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationHostMapping> {
    return this.service.deleteHostDomain(id);
  }

  /** GET /api/settings/communication/alerts — the saved switch, or its default. */
  @Get('communication/alerts')
  getCommunicationAlerts(): Promise<CommunicationAlertsSettings> {
    return this.service.getCommunicationAlerts();
  }

  /** PUT /api/settings/communication/alerts — replaces it; returns what was stored. */
  @Put('communication/alerts')
  saveCommunicationAlerts(
    @Body() dto: UpdateCommunicationAlertsDto,
  ): Promise<CommunicationAlertsSettings> {
    return this.service.saveCommunicationAlerts(dto);
  }

  /** GET /api/settings/assignment/general — the saved payload, or the defaults. */
  @Get('assignment/general')
  getAssignmentGeneral(): Promise<AssignmentGeneralSettings> {
    return this.service.getAssignmentGeneral();
  }

  /** PUT /api/settings/assignment/general — replaces it; returns what was stored. */
  @Put('assignment/general')
  saveAssignmentGeneral(
    @Body() dto: UpdateAssignmentGeneralDto,
  ): Promise<AssignmentGeneralSettings> {
    return this.service.saveAssignmentGeneral(dto);
  }

  /** GET /api/settings/call-tracking/general — the saved payload, or the defaults. */
  @Get('call-tracking/general')
  getCallTrackingGeneral(): Promise<CallTrackingGeneralSettings> {
    return this.service.getCallTrackingGeneral();
  }

  /** PUT /api/settings/call-tracking/general — replaces it; returns what was stored. */
  @Put('call-tracking/general')
  saveCallTrackingGeneral(
    @Body() dto: UpdateCallTrackingGeneralDto,
  ): Promise<CallTrackingGeneralSettings> {
    return this.service.saveCallTrackingGeneral(dto);
  }

  /** GET /api/settings/call-tracking/call-statuses — all six, in the reference's order. */
  @Get('call-tracking/call-statuses')
  getCallStatuses(): Promise<CallStatusRow[]> {
    return this.service.getCallStatuses();
  }

  /**
   * PATCH /api/settings/call-tracking/call-statuses/:providerStatus — renames one
   * label. The provider status is a path segment precisely because it is not editable.
   */
  @Patch('call-tracking/call-statuses/:providerStatus')
  saveCallStatus(
    @Param('providerStatus') providerStatus: string,
    @Body() dto: UpdateCallStatusDto,
  ): Promise<CallStatusRow[]> {
    return this.service.saveCallStatus(providerStatus, dto);
  }

  /** GET /api/settings/activity-reminders/general — the saved payload, or the defaults. */
  @Get('activity-reminders/general')
  getActivityGeneral(): Promise<ActivityGeneralSettings> {
    return this.service.getActivityGeneral();
  }

  /** PUT /api/settings/activity-reminders/general — replaces the payload. */
  @Put('activity-reminders/general')
  saveActivityGeneral(
    @Body() dto: UpdateActivityGeneralDto,
  ): Promise<ActivityGeneralSettings> {
    return this.service.saveActivityGeneral(dto);
  }

  /** GET /api/settings/activity-reminders/follow-up-types — the configured types. */
  @Get('activity-reminders/follow-up-types')
  getFollowUpTypes(): Promise<FollowUpType[]> {
    return this.service.getFollowUpTypes();
  }

  /** POST /api/settings/activity-reminders/follow-up-types — adds one; returns the list. */
  @Post('activity-reminders/follow-up-types')
  async createFollowUpType(
    @Body() dto: SaveFollowUpTypeDto,
  ): Promise<FollowUpType[]> {
    const actor = await this.currentUser.resolve();
    return this.service.createFollowUpType(dto, actor.id);
  }

  /** PATCH /api/settings/activity-reminders/follow-up-types/:id — edits one. */
  @Patch('activity-reminders/follow-up-types/:id')
  updateFollowUpType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveFollowUpTypeDto,
  ): Promise<FollowUpType[]> {
    return this.service.updateFollowUpType(id, dto);
  }

  /** DELETE /api/settings/activity-reminders/follow-up-types/:id — removes one. */
  @Delete('activity-reminders/follow-up-types/:id')
  deleteFollowUpType(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FollowUpType[]> {
    return this.service.deleteFollowUpType(id);
  }

  /**
   * GET /api/settings/activity-reminders/workflow — the follow-up form's own configuration.
   *
   * The one read on this controller that is not `SUPERADMIN`: an agent's Add Follow-up
   * drawer has to honour the configured types, their field order and the workflow
   * switches, and it cannot honour what it is forbidden to read. Every mutation above
   * stays administrator-only, so this widens a read, never a write (ADR-0071).
   */
  @Get('activity-reminders/workflow')
  @Roles(...Object.values(UserRole))
  getActivityWorkflow(): Promise<ActivityWorkflowSettings> {
    return this.service.getActivityWorkflow();
  }

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
