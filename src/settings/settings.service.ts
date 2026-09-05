import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CustomFieldNames,
  LEAD_DISPLAY_MODES,
  LEAD_DISPLAY_ORDERS,
  LEAD_ORDER_FIELDS,
  MAX_MASK_DIGITS,
  MAX_NO_ACTIVITY_THRESHOLD,
  MIN_MASK_DIGITS,
  MIN_NO_ACTIVITY_THRESHOLD,
  NO_ACTIVITY_UNITS,
  NOTE_DISPLAY_TYPES,
  PIPELINE_CHANGE_ASSIGNEES,
  SALES_CRM_GENERAL_DEFAULTS,
  SALES_CRM_GENERAL_KEY,
  SalesCrmGeneralSettings,
  TAG_PERMISSIONS,
  UpdateSalesCrmGeneralDto,
} from './dto/sales-crm-general.dto';
import {
  DUPLICATE_LOG_LIMIT,
  DUPLICATE_MODES,
  DuplicateMode,
  DuplicateSettingsLogEntry,
  SALES_CRM_DUPLICATE_DEFAULTS,
  SALES_CRM_DUPLICATE_KEY,
  SalesCrmDuplicateSettings,
  UpdateSalesCrmDuplicateDto,
} from './dto/sales-crm-duplicate.dto';
import {
  DATE_DISPLAY_FORMATS,
  DateDisplayFormat,
  MAX_SHIFT_HOUR,
  MAX_SHIFT_MINUTE,
  MERIDIEMS,
  Meridiem,
  MIN_SHIFT_HOUR,
  MIN_SHIFT_MINUTE,
  ORGANIZATION_GENERAL_DEFAULTS,
  ORGANIZATION_GENERAL_KEY,
  OrganizationGeneralSettings,
  PAGINATION_LIMITS,
  PaginationLimit,
  UpdateOrganizationGeneralDto,
  WEEKDAYS,
} from './dto/organization-general.dto';
import {
  MAX_ADDRESS_LINE,
  MAX_COMPANY_NAME,
  MAX_EMAIL,
  MAX_LATITUDE,
  MAX_LONGITUDE,
  MAX_PLACE_NAME,
  MAX_TELEPHONE,
  MAX_WEBSITE,
  MAX_ZIP_CODE,
  MIN_LATITUDE,
  MIN_LONGITUDE,
  ORGANIZATION_COMPANY_DEFAULTS,
  ORGANIZATION_COMPANY_KEY,
  OrganizationCompanyDetails,
  UpdateOrganizationCompanyDto,
} from './dto/organization-company.dto';
import {
  CreateHostDomainDto,
  DOMAIN_PATTERN,
  HostDomain,
  MAX_DOMAIN_NAME,
  MAX_FROM_EMAIL_ADDRESS,
  MAX_FROM_EMAIL_NAME,
  MAX_HOST_DOMAINS,
  ORGANIZATION_HOST_MAPPING_KEY,
  OrganizationHostMapping,
} from './dto/organization-host-mapping.dto';
import {
  COMMUNICATION_ALERTS_DEFAULTS,
  COMMUNICATION_ALERTS_KEY,
  CommunicationAlertsSettings,
  UpdateCommunicationAlertsDto,
} from './dto/communication-alerts.dto';
import {
  ASSIGNMENT_GENERAL_DEFAULTS,
  ASSIGNMENT_GENERAL_KEY,
  AssignmentGeneralSettings,
  LEAD_LIMIT_METHODS,
  LeadLimitMethod,
  MAX_DAILY_LEAD_LIMIT,
  MAX_RECHECK_HOUR,
  MAX_RECHECK_MINUTE,
  MERIDIEMS as ASSIGNMENT_MERIDIEMS,
  MIN_DAILY_LEAD_LIMIT,
  MIN_RECHECK_HOUR,
  MIN_RECHECK_MINUTE,
  Meridiem as AssignmentMeridiem,
  UpdateAssignmentGeneralDto,
} from './dto/assignment-general.dto';
import {
  CALL_PROVIDER_MODES,
  CALL_PROVIDER_STATUSES,
  CALL_STATUS_DEFAULTS,
  CALL_TRACKING_GENERAL_DEFAULTS,
  CALL_TRACKING_GENERAL_KEY,
  CALL_TRACKING_STATUSES_KEY,
  CALL_TYPES,
  CallProviderMode,
  CallStatusRow,
  CallTrackingGeneralSettings,
  CallType,
  MAX_CUSTOM_STATUS_NAME,
  UpdateCallStatusDto,
  UpdateCallTrackingGeneralDto,
} from './dto/call-tracking.dto';
import {
  ACTIVITY_FOLLOW_UP_TYPES_KEY,
  ACTIVITY_GENERAL_DEFAULTS,
  ACTIVITY_GENERAL_KEY,
  ActivityGeneralSettings,
  ActivityWorkflowSettings,
  FOLLOW_UP_FIELDS,
  FOLLOW_UP_FIELD_KEYS,
  FollowUpFieldKey,
  FollowUpType,
  FollowUpTypeField,
  FollowUpTypeFieldDto,
  MAX_FOLLOW_UP_TYPES,
  MAX_FOLLOW_UP_TYPE_NAME,
  OVERDUE_MINUTES,
  OVERDUE_MODES,
  OverdueMinutes,
  REMINDER_TIME_KEYS,
  REQUIRED_FOLLOW_UP_FIELDS,
  SHIPPED_FOLLOW_UP_TYPES,
  SaveFollowUpTypeDto,
  UpdateActivityGeneralDto,
} from './dto/activity-reminders.dto';
import { CURRENCY_CODES } from '../lookups/lookups.data';

/**
 * App-global Settings, stored one JSON row per screen in `app_settings`.
 *
 * Reads are defensive on purpose: a row written before a field existed, or hand-edited,
 * must never reach the client half-formed. Every field is validated on the way out and
 * falls back to its shipped default individually, so one bad key costs one value rather
 * than the whole screen. The DTO already guards the way in — this is the second half of
 * the same contract, and it is what lets the payload be JSON instead of 17 columns.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The Organization → General Settings payload, or the shipped defaults. */
  async getOrganizationGeneral(): Promise<OrganizationGeneralSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ORGANIZATION_GENERAL_KEY },
      select: { value: true },
    });
    return toOrganizationGeneral(row?.value);
  }

  /**
   * Replaces the whole payload; one row per key, created on first save.
   *
   * Off days are stored in weekday order rather than click order, so the chips read the
   * same way whatever sequence they were picked in.
   */
  async saveOrganizationGeneral(
    dto: UpdateOrganizationGeneralDto,
  ): Promise<OrganizationGeneralSettings> {
    const settings: OrganizationGeneralSettings = {
      currency: dto.currency,
      dateDisplayFormat: dto.dateDisplayFormat,
      tablePaginationLimit: dto.tablePaginationLimit,
      organizationalGrouping: dto.organizationalGrouping,
      shiftStartHour: dto.shiftStartHour,
      shiftStartMinute: dto.shiftStartMinute,
      shiftStartPeriod: dto.shiftStartPeriod,
      shiftEndHour: dto.shiftEndHour,
      shiftEndMinute: dto.shiftEndMinute,
      shiftEndPeriod: dto.shiftEndPeriod,
      offDays: [...WEEKDAYS].filter((day) => dto.offDays.includes(day)),
      productModuleEnabled: dto.productModuleEnabled,
    };

    await this.prisma.appSetting.upsert({
      where: { key: ORGANIZATION_GENERAL_KEY },
      update: { value: settings as unknown as Prisma.InputJsonValue },
      create: {
        key: ORGANIZATION_GENERAL_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return settings;
  }

  /** The Organization → Company Details payload, or a blank record. */
  async getOrganizationCompany(): Promise<OrganizationCompanyDetails> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ORGANIZATION_COMPANY_KEY },
      select: { value: true },
    });
    return toOrganizationCompany(row?.value);
  }

  /**
   * Replaces the whole payload; one row per key, created on first save.
   *
   * The DTO has already trimmed and validated every field, so what is stored is exactly
   * what comes back — no second normalisation to drift out of step with it.
   */
  async saveOrganizationCompany(
    dto: UpdateOrganizationCompanyDto,
  ): Promise<OrganizationCompanyDetails> {
    const settings: OrganizationCompanyDetails = {
      companyName: dto.companyName,
      address: dto.address,
      street: dto.street,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      zipCode: dto.zipCode,
      telephoneCountry: dto.telephoneCountry,
      telephone: dto.telephone,
      email: dto.email,
      website: dto.website,
      latitude: dto.latitude,
      longitude: dto.longitude,
    };

    await this.prisma.appSetting.upsert({
      where: { key: ORGANIZATION_COMPANY_KEY },
      update: { value: settings as unknown as Prisma.InputJsonValue },
      create: {
        key: ORGANIZATION_COMPANY_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return settings;
  }

  /** The Organization → Host Mapping list, or an empty one. */
  async getOrganizationHostMapping(): Promise<OrganizationHostMapping> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ORGANIZATION_HOST_MAPPING_KEY },
      select: { value: true },
    });
    return toOrganizationHostMapping(row?.value);
  }

  /**
   * Appends one domain and returns the whole list, so the screen never needs a second
   * request to redraw.
   *
   * Read-modify-write on one JSON row: two administrators adding a domain in the same
   * instant would have the later write win. Acceptable here — the row is edited by
   * `SUPERADMIN` from a settings screen, not by concurrent traffic — and the reason this
   * is a list rather than a table (ADR-0067).
   */
  async addHostDomain(
    dto: CreateHostDomainDto,
  ): Promise<OrganizationHostMapping> {
    const current = await this.getOrganizationHostMapping();

    // Mapping the same domain twice has no meaning, and the DTO has already lowercased it.
    if (
      current.domains.some((domain) => domain.domainName === dto.domainName)
    ) {
      throw new ConflictException(`${dto.domainName} is already mapped.`);
    }
    if (current.domains.length >= MAX_HOST_DOMAINS) {
      throw new BadRequestException(
        `A maximum of ${MAX_HOST_DOMAINS} domains can be mapped.`,
      );
    }

    const domains: HostDomain[] = [
      ...current.domains,
      {
        id: randomUUID(),
        domainName: dto.domainName,
        fromEmailAddress: dto.fromEmailAddress,
        fromEmailName: dto.fromEmailName,
        createdAt: new Date().toISOString(),
      },
    ];

    return this.writeHostMapping(domains);
  }

  /** Removes one domain and returns what is left; an unknown id is a 404, not a no-op. */
  async deleteHostDomain(id: string): Promise<OrganizationHostMapping> {
    const current = await this.getOrganizationHostMapping();
    const domains = current.domains.filter((domain) => domain.id !== id);

    if (domains.length === current.domains.length) {
      throw new NotFoundException('That domain is no longer mapped.');
    }
    return this.writeHostMapping(domains);
  }

  private async writeHostMapping(
    domains: HostDomain[],
  ): Promise<OrganizationHostMapping> {
    const mapping: OrganizationHostMapping = { domains };

    await this.prisma.appSetting.upsert({
      where: { key: ORGANIZATION_HOST_MAPPING_KEY },
      update: { value: mapping as unknown as Prisma.InputJsonValue },
      create: {
        key: ORGANIZATION_HOST_MAPPING_KEY,
        value: mapping as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return mapping;
  }

  /** The Communication → Emarath Alerts payload, or the shipped default. */
  async getCommunicationAlerts(): Promise<CommunicationAlertsSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: COMMUNICATION_ALERTS_KEY },
      select: { value: true },
    });
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    return {
      alertsEnabled:
        typeof raw.alertsEnabled === 'boolean'
          ? raw.alertsEnabled
          : COMMUNICATION_ALERTS_DEFAULTS.alertsEnabled,
    };
  }

  /** Replaces the payload; one row per key, created on first save. */
  async saveCommunicationAlerts(
    dto: UpdateCommunicationAlertsDto,
  ): Promise<CommunicationAlertsSettings> {
    const settings: CommunicationAlertsSettings = {
      alertsEnabled: dto.alertsEnabled,
    };

    await this.prisma.appSetting.upsert({
      where: { key: COMMUNICATION_ALERTS_KEY },
      update: { value: settings as unknown as Prisma.InputJsonValue },
      create: {
        key: COMMUNICATION_ALERTS_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return settings;
  }

  /** The Assignment → General Settings payload, or the shipped defaults. */
  async getAssignmentGeneral(): Promise<AssignmentGeneralSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ASSIGNMENT_GENERAL_KEY },
      select: { value: true },
    });
    return toAssignmentGeneral(row?.value);
  }

  /**
   * Replaces the whole payload; one row per key, created on first save.
   *
   * The dependent fields are stored whatever their parent toggle says: the reference
   * hides the re-check time while carryover is off and the daily limit while the limit
   * is off, and clearing what is merely hidden would discard a choice the user made.
   */
  async saveAssignmentGeneral(
    dto: UpdateAssignmentGeneralDto,
  ): Promise<AssignmentGeneralSettings> {
    const settings: AssignmentGeneralSettings = {
      automaticLeadAssigning: dto.automaticLeadAssigning,
      carryoverLeads: dto.carryoverLeads,
      includeFollowUpLeadsInCarryover: dto.includeFollowUpLeadsInCarryover,
      checkUserLoggedInBeforeAssigning: dto.checkUserLoggedInBeforeAssigning,
      recheckHour: dto.recheckHour,
      recheckMinute: dto.recheckMinute,
      recheckPeriod: dto.recheckPeriod,
      leadAssignmentLimitEnabled: dto.leadAssignmentLimitEnabled,
      leadLimitMethod: dto.leadLimitMethod,
      dailyLeadLimit: dto.dailyLeadLimit,
      whatsappRoundRobin: dto.whatsappRoundRobin,
      saveFirstIncomingMessageAsNote: dto.saveFirstIncomingMessageAsNote,
    };

    await this.prisma.appSetting.upsert({
      where: { key: ASSIGNMENT_GENERAL_KEY },
      update: { value: settings as unknown as Prisma.InputJsonValue },
      create: {
        key: ASSIGNMENT_GENERAL_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return settings;
  }

  /** The Call Tracking → General Settings payload, or the shipped defaults. */
  async getCallTrackingGeneral(): Promise<CallTrackingGeneralSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: CALL_TRACKING_GENERAL_KEY },
      select: { value: true },
    });
    return toCallTrackingGeneral(row?.value);
  }

  /** Replaces the whole payload; one row per key, created on first save. */
  async saveCallTrackingGeneral(
    dto: UpdateCallTrackingGeneralDto,
  ): Promise<CallTrackingGeneralSettings> {
    const settings: CallTrackingGeneralSettings = {
      outgoingCallType: dto.outgoingCallType,
      incomingCallType: dto.incomingCallType,
      callProviderMode: dto.callProviderMode,
    };

    await this.prisma.appSetting.upsert({
      where: { key: CALL_TRACKING_GENERAL_KEY },
      update: { value: settings as unknown as Prisma.InputJsonValue },
      create: {
        key: CALL_TRACKING_GENERAL_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return settings;
  }

  /**
   * The six provider statuses with their custom labels — always all six, always in the
   * reference's order, whatever the stored row happens to hold.
   */
  async getCallStatuses(): Promise<CallStatusRow[]> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: CALL_TRACKING_STATUSES_KEY },
      select: { value: true },
    });
    return toCallStatuses(row?.value);
  }

  /**
   * Renames one status's customer-facing label. The provider status arrives in the path
   * and is never written: it is the key of the vocabulary, not a value to be edited, and
   * the Call model's own `CallOutcome` is untouched by this (ADR-0070).
   */
  async saveCallStatus(
    providerStatus: string,
    dto: UpdateCallStatusDto,
  ): Promise<CallStatusRow[]> {
    const known = CALL_PROVIDER_STATUSES.some(
      (status) => status.key === providerStatus,
    );
    if (!known) {
      throw new NotFoundException(`Unknown call status "${providerStatus}".`);
    }

    const current = await this.getCallStatuses();
    const statuses = current.map((status) =>
      status.providerStatus === providerStatus
        ? { ...status, customName: dto.customName }
        : status,
    );

    await this.prisma.appSetting.upsert({
      where: { key: CALL_TRACKING_STATUSES_KEY },
      update: { value: statuses as unknown as Prisma.InputJsonValue },
      create: {
        key: CALL_TRACKING_STATUSES_KEY,
        value: statuses as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return statuses;
  }

  /** The Sales & CRM → Duplicate Settings payload, or the shipped defaults. */
  async getSalesCrmDuplicate(): Promise<SalesCrmDuplicateSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: SALES_CRM_DUPLICATE_KEY },
      select: { value: true },
    });
    return toSalesCrmDuplicate(row?.value);
  }

  /**
   * Replaces the payload, keeping the change log.
   *
   * Every dependent value is stored whatever the mode: the reference hides the warn
   * toggle in block mode and the two block toggles in warn mode, and clearing what is
   * merely hidden would silently discard a choice the user made — switching modes and
   * back would lose it.
   *
   * The log is appended here rather than in a separate audit system: the project keeps
   * no audit table, and one entry per *actual* change keeps the row bounded and quiet —
   * saving without changing anything records nothing.
   */
  async saveSalesCrmDuplicate(
    dto: UpdateSalesCrmDuplicateDto,
    actorId: string,
  ): Promise<SalesCrmDuplicateSettings> {
    const before = await this.getSalesCrmDuplicate();
    const changes = describeDuplicateChanges(before, dto);

    // Only looked up when something actually changed, so a no-op save costs no query.
    const actorName =
      changes.length === 0
        ? null
        : ((
            await this.prisma.user.findUnique({
              where: { id: actorId },
              select: { name: true },
            })
          )?.name ?? null);

    const settings: SalesCrmDuplicateSettings = {
      mode: dto.mode,
      allowDuplicateSearch: dto.allowDuplicateSearch,
      displayAssigneeInfo: dto.displayAssigneeInfo,
      checkArchivedLeads: dto.checkArchivedLeads,
      log:
        changes.length === 0
          ? before.log
          : [
              {
                at: new Date().toISOString(),
                byName: actorName,
                changes,
              },
              ...before.log,
            ].slice(0, DUPLICATE_LOG_LIMIT),
    };

    await this.prisma.appSetting.upsert({
      where: { key: SALES_CRM_DUPLICATE_KEY },
      update: { value: settings as unknown as Prisma.InputJsonValue },
      create: {
        key: SALES_CRM_DUPLICATE_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return settings;
  }

  /** The Sales & CRM → General Settings payload, or the shipped defaults. */
  async getSalesCrmGeneral(): Promise<SalesCrmGeneralSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: SALES_CRM_GENERAL_KEY },
      select: { value: true },
    });
    return toSalesCrmGeneral(row?.value);
  }

  /**
   * Replaces the whole payload; one row per key, created on first save.
   *
   * The masking role is kept even while masking is off: it is inert, not wrong, and
   * clearing it would silently discard a choice the form still shows — turning masking
   * off and on again would lose it.
   */
  async saveSalesCrmGeneral(
    dto: UpdateSalesCrmGeneralDto,
  ): Promise<SalesCrmGeneralSettings> {
    const settings: SalesCrmGeneralSettings = {
      displayLeads: dto.displayLeads,
      displayOrder: dto.displayOrder,
      orderBy: dto.orderBy,
      requireCompanyName: dto.requireCompanyName,
      noteDisplay: dto.noteDisplay,
      fieldNames: {
        state: dto.fieldNames.state.trim(),
        district: dto.fieldNames.district.trim(),
        city: dto.fieldNames.city.trim(),
        zipcode: dto.fieldNames.zipcode.trim(),
        actualAmount: dto.fieldNames.actualAmount.trim(),
        forecastedAmount: dto.fieldNames.forecastedAmount.trim(),
        tag: dto.fieldNames.tag.trim(),
        category: dto.fieldNames.category.trim(),
      },
      actualAmountTimeline: dto.actualAmountTimeline,
      defaultCountryCode: dto.defaultCountryCode.toUpperCase(),
      tagPermission: dto.tagPermission,
      maskMobileNumbers: dto.maskMobileNumbers,
      maskingRole: dto.maskingRole ?? null,
      maskDigits: dto.maskDigits,
      pipelineChangeAssignee: dto.pipelineChangeAssignee,
      noActivityThreshold: dto.noActivityThreshold,
      noActivityUnit: dto.noActivityUnit,
      noActivityNotifications: dto.noActivityNotifications,
    };

    // A typed interface lacks the index signature Prisma's JSON input requires; the write
    // is the object above, the cast only satisfies that column type.
    const value = settings as unknown as Prisma.InputJsonValue;

    await this.prisma.appSetting.upsert({
      where: { key: SALES_CRM_GENERAL_KEY },
      create: { key: SALES_CRM_GENERAL_KEY, value },
      update: { value },
    });

    return settings;
  }

  /** The Activity and Reminders → General Settings payload, or the shipped defaults. */
  async getActivityGeneral(): Promise<ActivityGeneralSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ACTIVITY_GENERAL_KEY },
      select: { value: true },
    });
    return toActivityGeneral(row?.value);
  }

  /** Replaces the whole payload; one row per key, created on first save. */
  async saveActivityGeneral(
    dto: UpdateActivityGeneralDto,
  ): Promise<ActivityGeneralSettings> {
    const settings: ActivityGeneralSettings = {
      autoPromptFollowUpOnCompletion: dto.autoPromptFollowUpOnCompletion,
      followUpMandatoryOnStatusChange: dto.followUpMandatoryOnStatusChange,
      remindersEnabled: dto.remindersEnabled,
      reminderTime: dto.reminderTime,
      overdueMode: dto.overdueMode,
      overdueAfterMinutes: dto.overdueAfterMinutes,
    };

    await this.prisma.appSetting.upsert({
      where: { key: ACTIVITY_GENERAL_KEY },
      update: { value: settings as unknown as Prisma.InputJsonValue },
      create: {
        key: ACTIVITY_GENERAL_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return settings;
  }

  /**
   * The configured follow-up types, seeded on first read.
   *
   * Seeded rather than synthesised in the response because the reference's "Date and
   * Time" column prints a real stored timestamp: the three shipped types need one, and a
   * hardcoded date would be a lie the table repeats forever. Idempotent — once the row
   * exists it is the only answer.
   */
  async getFollowUpTypes(): Promise<FollowUpType[]> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ACTIVITY_FOLLOW_UP_TYPES_KEY },
      select: { value: true },
    });
    if (row) return toFollowUpTypes(row.value);

    const createdAt = new Date().toISOString();
    return this.writeFollowUpTypes(
      SHIPPED_FOLLOW_UP_TYPES.map((type) => ({
        ...type,
        id: randomUUID(),
        createdAt,
        fields: type.fields.map((field) => ({ ...field })),
      })),
    );
  }

  /** Appends one type and returns the whole list, so the table redraws without a refetch. */
  async createFollowUpType(
    dto: SaveFollowUpTypeDto,
    actorId: string,
  ): Promise<FollowUpType[]> {
    const current = await this.getFollowUpTypes();
    assertNameFree(current, dto.name, null);

    if (current.length >= MAX_FOLLOW_UP_TYPES) {
      throw new BadRequestException(
        `A maximum of ${MAX_FOLLOW_UP_TYPES} follow up types can be configured.`,
      );
    }

    // The reference's Created By column prints a person, so the name is captured at
    // creation the way the Duplicate Settings log captures its actor.
    const creator = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    return this.writeFollowUpTypes([
      ...current,
      {
        id: randomUUID(),
        name: dto.name,
        isActive: dto.isActive,
        // A custom type has no ActivityType to be stored as; only the shipped three do.
        activityType: null,
        createdBy: creator?.name ?? 'ADMIN',
        createdAt: new Date().toISOString(),
        fields: normaliseFollowUpFields(dto.fields),
      },
    ]);
  }

  /**
   * Edits one type. `activityType`, `createdBy` and `createdAt` are not editable — they
   * are what the row *is*, not what it is configured to be.
   */
  async updateFollowUpType(
    id: string,
    dto: SaveFollowUpTypeDto,
  ): Promise<FollowUpType[]> {
    const current = await this.getFollowUpTypes();
    if (!current.some((type) => type.id === id)) {
      throw new NotFoundException('That follow up type no longer exists.');
    }
    assertNameFree(current, dto.name, id);

    const fields = normaliseFollowUpFields(dto.fields);
    return this.writeFollowUpTypes(
      current.map((type) =>
        type.id === id
          ? { ...type, name: dto.name, isActive: dto.isActive, fields }
          : type,
      ),
    );
  }

  /**
   * Removes one type — unless follow-ups are filed under it.
   *
   * The three shipped types are the `ActivityType` enum, so "in use" is a real count of
   * live activities rather than a guess. Deleting one would orphan them, and the row has
   * an Inactive state that hides it from the form without touching history, so the
   * refusal names it.
   */
  async deleteFollowUpType(id: string): Promise<FollowUpType[]> {
    const current = await this.getFollowUpTypes();
    const target = current.find((type) => type.id === id);
    if (!target) {
      throw new NotFoundException('That follow up type no longer exists.');
    }

    if (target.activityType) {
      const inUse = await this.prisma.activity.count({
        where: { type: target.activityType, deletedAt: null },
      });
      if (inUse > 0) {
        throw new ConflictException(
          `${target.name} is used by ${inUse} follow-up${inUse === 1 ? '' : 's'}. Set it to Inactive instead of deleting it.`,
        );
      }
    }

    return this.writeFollowUpTypes(current.filter((type) => type.id !== id));
  }

  /**
   * What the follow-up form needs at runtime: the workflow switches and the *active*
   * types with their field order. Inactive types are filtered out here rather than in the
   * client, so a deactivated type cannot be selected by a stale page.
   */
  async getActivityWorkflow(): Promise<ActivityWorkflowSettings> {
    const [general, types] = await Promise.all([
      this.getActivityGeneral(),
      this.getFollowUpTypes(),
    ]);
    return {
      general,
      followUpTypes: types.filter((type) => type.isActive),
    };
  }

  private async writeFollowUpTypes(
    types: FollowUpType[],
  ): Promise<FollowUpType[]> {
    await this.prisma.appSetting.upsert({
      where: { key: ACTIVITY_FOLLOW_UP_TYPES_KEY },
      update: { value: types as unknown as Prisma.InputJsonValue },
      create: {
        key: ACTIVITY_FOLLOW_UP_TYPES_KEY,
        value: types as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return types;
  }
}

/** A stored row back into settings, field by field, defaulting anything unreadable. */
export function toSalesCrmGeneral(
  value: Prisma.JsonValue | undefined,
): SalesCrmGeneralSettings {
  const d = SALES_CRM_GENERAL_DEFAULTS;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return d;
  const raw = value as Record<string, unknown>;

  return {
    displayLeads: oneOf(raw.displayLeads, LEAD_DISPLAY_MODES, d.displayLeads),
    displayOrder: oneOf(raw.displayOrder, LEAD_DISPLAY_ORDERS, d.displayOrder),
    orderBy: oneOf(raw.orderBy, LEAD_ORDER_FIELDS, d.orderBy),
    requireCompanyName: bool(raw.requireCompanyName, d.requireCompanyName),
    noteDisplay: oneOf(raw.noteDisplay, NOTE_DISPLAY_TYPES, d.noteDisplay),
    fieldNames: toFieldNames(raw.fieldNames),
    actualAmountTimeline: bool(
      raw.actualAmountTimeline,
      d.actualAmountTimeline,
    ),
    defaultCountryCode:
      typeof raw.defaultCountryCode === 'string' &&
      raw.defaultCountryCode.length === 2
        ? raw.defaultCountryCode.toUpperCase()
        : d.defaultCountryCode,
    tagPermission: oneOf(raw.tagPermission, TAG_PERMISSIONS, d.tagPermission),
    maskMobileNumbers: bool(raw.maskMobileNumbers, d.maskMobileNumbers),
    maskingRole:
      typeof raw.maskingRole === 'string' &&
      (Object.values(UserRole) as string[]).includes(raw.maskingRole)
        ? (raw.maskingRole as UserRole)
        : null,
    maskDigits: int(
      raw.maskDigits,
      MIN_MASK_DIGITS,
      MAX_MASK_DIGITS,
      d.maskDigits,
    ),
    pipelineChangeAssignee: oneOf(
      raw.pipelineChangeAssignee,
      PIPELINE_CHANGE_ASSIGNEES,
      d.pipelineChangeAssignee,
    ),
    noActivityThreshold: int(
      raw.noActivityThreshold,
      MIN_NO_ACTIVITY_THRESHOLD,
      MAX_NO_ACTIVITY_THRESHOLD,
      d.noActivityThreshold,
    ),
    noActivityUnit: oneOf(
      raw.noActivityUnit,
      NO_ACTIVITY_UNITS,
      d.noActivityUnit,
    ),
    noActivityNotifications: bool(
      raw.noActivityNotifications,
      d.noActivityNotifications,
    ),
  };
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

/** Each label defaults on its own, so one blank key cannot unname the other seven. */
function toFieldNames(value: unknown): CustomFieldNames {
  const d = SALES_CRM_GENERAL_DEFAULTS.fieldNames;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return d;
  const raw = value as Record<string, unknown>;
  const label = (key: keyof CustomFieldNames): string =>
    typeof raw[key] === 'string' && raw[key].trim() !== ''
      ? raw[key].trim()
      : d[key];

  return {
    state: label('state'),
    district: label('district'),
    city: label('city'),
    zipcode: label('zipcode'),
    actualAmount: label('actualAmount'),
    forecastedAmount: label('forecastedAmount'),
    tag: label('tag'),
    category: label('category'),
  };
}

/**
 * Reads a stored duplicate payload defensively, as the general settings are read: every
 * field falls back to its shipped default individually, so a row written before a field
 * existed costs that one value rather than the whole screen.
 */
function toSalesCrmDuplicate(value: unknown): SalesCrmDuplicateSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const bool = (key: keyof SalesCrmDuplicateSettings): boolean =>
    typeof raw[key] === 'boolean'
      ? raw[key]
      : (SALES_CRM_DUPLICATE_DEFAULTS[key] as boolean);

  const mode = DUPLICATE_MODES.includes(raw.mode as DuplicateMode)
    ? (raw.mode as DuplicateMode)
    : SALES_CRM_DUPLICATE_DEFAULTS.mode;

  const log = Array.isArray(raw.log)
    ? (raw.log as unknown[])
        .filter(
          (entry): entry is DuplicateSettingsLogEntry =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as DuplicateSettingsLogEntry).at === 'string' &&
            Array.isArray((entry as DuplicateSettingsLogEntry).changes),
        )
        .slice(0, DUPLICATE_LOG_LIMIT)
    : [];

  return {
    mode,
    allowDuplicateSearch: bool('allowDuplicateSearch'),
    displayAssigneeInfo: bool('displayAssigneeInfo'),
    checkArchivedLeads: bool('checkArchivedLeads'),
    log,
  };
}

const MODE_LABELS: Record<DuplicateMode, string> = {
  WARN_ALLOW_SAVE: 'Warn, allow save',
  BLOCK_HARD_STOP: 'Block, hard stop',
};

/** One sentence per field that actually changed; an unchanged save records nothing. */
function describeDuplicateChanges(
  before: SalesCrmDuplicateSettings,
  after: UpdateSalesCrmDuplicateDto,
): string[] {
  const changes: string[] = [];
  if (before.mode !== after.mode) {
    changes.push(
      `Duplicate handling changed from “${MODE_LABELS[before.mode]}” to “${MODE_LABELS[after.mode]}”`,
    );
  }
  const toggles: [keyof UpdateSalesCrmDuplicateDto, string][] = [
    ['allowDuplicateSearch', 'Ability to search and view Duplicate leads'],
    ['displayAssigneeInfo', 'Display Assignee Information for Duplicate Leads'],
    ['checkArchivedLeads', 'Check archived leads for duplicates'],
  ];
  for (const [key, label] of toggles) {
    const was = before[key as keyof SalesCrmDuplicateSettings] as boolean;
    const now = after[key] as boolean;
    if (was !== now) changes.push(`${label} turned ${now ? 'on' : 'off'}`);
  }
  return changes;
}

/**
 * Reads a stored organization payload defensively, as the other screens are read: every
 * field falls back to its shipped default individually, so a row written before a field
 * existed — or hand-edited — costs that one value rather than the whole screen.
 */
function toOrganizationGeneral(value: unknown): OrganizationGeneralSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const d = ORGANIZATION_GENERAL_DEFAULTS;

  const bool = (key: keyof OrganizationGeneralSettings): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] : (d[key] as boolean);

  const clock = (
    key: keyof OrganizationGeneralSettings,
    min: number,
    max: number,
  ) => {
    const candidate = raw[key];
    return typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= min &&
      candidate <= max
      ? candidate
      : (d[key] as number);
  };

  const meridiem = (key: keyof OrganizationGeneralSettings): Meridiem =>
    MERIDIEMS.includes(raw[key] as Meridiem)
      ? (raw[key] as Meridiem)
      : (d[key] as Meridiem);

  return {
    currency: CURRENCY_CODES.includes(raw.currency as string)
      ? (raw.currency as string)
      : d.currency,
    dateDisplayFormat: DATE_DISPLAY_FORMATS.includes(
      raw.dateDisplayFormat as DateDisplayFormat,
    )
      ? (raw.dateDisplayFormat as DateDisplayFormat)
      : d.dateDisplayFormat,
    tablePaginationLimit: PAGINATION_LIMITS.includes(
      raw.tablePaginationLimit as PaginationLimit,
    )
      ? (raw.tablePaginationLimit as PaginationLimit)
      : d.tablePaginationLimit,
    organizationalGrouping: bool('organizationalGrouping'),
    shiftStartHour: clock('shiftStartHour', MIN_SHIFT_HOUR, MAX_SHIFT_HOUR),
    shiftStartMinute: clock(
      'shiftStartMinute',
      MIN_SHIFT_MINUTE,
      MAX_SHIFT_MINUTE,
    ),
    shiftStartPeriod: meridiem('shiftStartPeriod'),
    shiftEndHour: clock('shiftEndHour', MIN_SHIFT_HOUR, MAX_SHIFT_HOUR),
    shiftEndMinute: clock('shiftEndMinute', MIN_SHIFT_MINUTE, MAX_SHIFT_MINUTE),
    shiftEndPeriod: meridiem('shiftEndPeriod'),
    // Unknown or duplicated day names are dropped, and the rest come back in week order.
    offDays: Array.isArray(raw.offDays)
      ? [...WEEKDAYS].filter((day) => (raw.offDays as unknown[]).includes(day))
      : d.offDays,
    productModuleEnabled: bool('productModuleEnabled'),
  };
}

/**
 * Reads a stored company payload defensively, as the other screens are read: a field that
 * is missing, the wrong type or out of range falls back to blank rather than reaching the
 * form half-formed. Lengths are re-checked here too, because a row can be hand-edited
 * after the DTO has had its say.
 */
/** The stored telephone is dial digits plus the local number, nothing else. */
const DIGITS = /^[0-9]*$/;

function toOrganizationCompany(value: unknown): OrganizationCompanyDetails {
  const raw = (value ?? {}) as Record<string, unknown>;

  const text = (key: keyof OrganizationCompanyDetails, max: number): string => {
    const candidate = raw[key];
    return typeof candidate === 'string' && candidate.trim().length <= max
      ? candidate.trim()
      : (ORGANIZATION_COMPANY_DEFAULTS[key] as string);
  };

  const coordinate = (
    key: 'latitude' | 'longitude',
    min: number,
    max: number,
  ): number | null => {
    const candidate = raw[key];
    return typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      candidate >= min &&
      candidate <= max
      ? candidate
      : null;
  };

  const telephoneCountry = text('telephoneCountry', 2).toUpperCase();

  return {
    companyName: text('companyName', MAX_COMPANY_NAME),
    address: text('address', MAX_ADDRESS_LINE),
    street: text('street', MAX_ADDRESS_LINE),
    city: text('city', MAX_PLACE_NAME),
    state: text('state', MAX_PLACE_NAME),
    country: text('country', MAX_PLACE_NAME),
    zipCode: text('zipCode', MAX_ZIP_CODE),
    telephoneCountry:
      telephoneCountry.length === 2
        ? telephoneCountry
        : ORGANIZATION_COMPANY_DEFAULTS.telephoneCountry,
    // Anything but digits is unusable by the phone control, so it is dropped whole.
    telephone: DIGITS.test(text('telephone', MAX_TELEPHONE))
      ? text('telephone', MAX_TELEPHONE)
      : '',
    email: text('email', MAX_EMAIL),
    website: text('website', MAX_WEBSITE),
    latitude: coordinate('latitude', MIN_LATITUDE, MAX_LATITUDE),
    longitude: coordinate('longitude', MIN_LONGITUDE, MAX_LONGITUDE),
  };
}

/**
 * Reads a stored host-mapping row defensively, as the other screens are read. A row is a
 * list here rather than a record, so the unit that falls back is the *entry*: anything
 * that is not a usable domain is dropped, and the rest of the list survives it.
 */
function toOrganizationHostMapping(value: unknown): OrganizationHostMapping {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw.domains)) return { domains: [] };

  const seen = new Set<string>();
  const domains: HostDomain[] = [];

  for (const entry of raw.domains as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;

    const id = text(row.id, 64);
    const domainName = text(row.domainName, MAX_DOMAIN_NAME).toLowerCase();
    // An entry with no id or no domain cannot be listed or deleted, so it is not a row.
    if (id === '' || !DOMAIN_PATTERN.test(domainName) || seen.has(domainName)) {
      continue;
    }
    seen.add(domainName);

    const createdAt = text(row.createdAt, 40);
    domains.push({
      id,
      domainName,
      fromEmailAddress: text(row.fromEmailAddress, MAX_FROM_EMAIL_ADDRESS),
      fromEmailName: text(row.fromEmailName, MAX_FROM_EMAIL_NAME),
      createdAt: Number.isNaN(Date.parse(createdAt))
        ? new Date(0).toISOString()
        : createdAt,
    });
  }

  return { domains };
}

/** A trimmed string, or '' when the value is unusable — lengths re-checked on the way out. */
function text(value: unknown, max: number): string {
  return typeof value === 'string' && value.trim().length <= max
    ? value.trim()
    : '';
}

/**
 * Reads a stored assignment payload defensively, as the other screens are read: every
 * field falls back to its shipped default individually, so a row written before a field
 * existed — or hand-edited — costs that one value rather than the whole screen.
 */
function toAssignmentGeneral(value: unknown): AssignmentGeneralSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const d = ASSIGNMENT_GENERAL_DEFAULTS;

  const bool = (key: keyof AssignmentGeneralSettings): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] : (d[key] as boolean);

  /** A cleared control is null, which is a value here rather than a missing one. */
  const bounded = (
    key: keyof AssignmentGeneralSettings,
    min: number,
    max: number,
  ): number | null => {
    if (raw[key] === null) return null;
    const candidate = raw[key];
    return typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= min &&
      candidate <= max
      ? candidate
      : (d[key] as number | null);
  };

  return {
    automaticLeadAssigning: bool('automaticLeadAssigning'),
    carryoverLeads: bool('carryoverLeads'),
    includeFollowUpLeadsInCarryover: bool('includeFollowUpLeadsInCarryover'),
    checkUserLoggedInBeforeAssigning: bool('checkUserLoggedInBeforeAssigning'),
    recheckHour: bounded('recheckHour', MIN_RECHECK_HOUR, MAX_RECHECK_HOUR),
    recheckMinute: bounded(
      'recheckMinute',
      MIN_RECHECK_MINUTE,
      MAX_RECHECK_MINUTE,
    ),
    recheckPeriod:
      raw.recheckPeriod === null
        ? null
        : ASSIGNMENT_MERIDIEMS.includes(raw.recheckPeriod as AssignmentMeridiem)
          ? (raw.recheckPeriod as AssignmentMeridiem)
          : d.recheckPeriod,
    leadAssignmentLimitEnabled: bool('leadAssignmentLimitEnabled'),
    leadLimitMethod: LEAD_LIMIT_METHODS.includes(
      raw.leadLimitMethod as LeadLimitMethod,
    )
      ? (raw.leadLimitMethod as LeadLimitMethod)
      : d.leadLimitMethod,
    dailyLeadLimit: bounded(
      'dailyLeadLimit',
      MIN_DAILY_LEAD_LIMIT,
      MAX_DAILY_LEAD_LIMIT,
    ),
    whatsappRoundRobin: bool('whatsappRoundRobin'),
    saveFirstIncomingMessageAsNote: bool('saveFirstIncomingMessageAsNote'),
  };
}

/**
 * Reads a stored call-tracking payload defensively, as the other screens are read: each
 * field falls back to its shipped default individually, and a cleared control stays
 * cleared because `null` is a value here rather than a missing one.
 */
function toCallTrackingGeneral(value: unknown): CallTrackingGeneralSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const d = CALL_TRACKING_GENERAL_DEFAULTS;

  const callType = (
    key: 'outgoingCallType' | 'incomingCallType',
  ): CallType | null => {
    if (raw[key] === null) return null;
    return CALL_TYPES.includes(raw[key] as CallType)
      ? (raw[key] as CallType)
      : d[key];
  };

  return {
    outgoingCallType: callType('outgoingCallType'),
    incomingCallType: callType('incomingCallType'),
    callProviderMode:
      raw.callProviderMode === null
        ? null
        : CALL_PROVIDER_MODES.includes(raw.callProviderMode as CallProviderMode)
          ? (raw.callProviderMode as CallProviderMode)
          : d.callProviderMode,
  };
}

/**
 * The vocabulary drives the answer, not the row: the six statuses and their order come
 * from the code, and the stored row only supplies custom names. A row missing a status,
 * carrying an unknown one, or holding an unusable name therefore cannot change what the
 * screen lists — it costs that one label, not the table.
 */
function toCallStatuses(value: unknown): CallStatusRow[] {
  const stored = new Map<string, string>();
  if (Array.isArray(value)) {
    for (const entry of value as unknown[]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      const key =
        typeof row.providerStatus === 'string' ? row.providerStatus : '';
      const name =
        typeof row.customName === 'string' ? row.customName.trim() : '';
      if (key !== '' && name !== '' && name.length <= MAX_CUSTOM_STATUS_NAME) {
        stored.set(key, name);
      }
    }
  }

  return CALL_STATUS_DEFAULTS.map((status) => ({
    ...status,
    customName: stored.get(status.providerStatus) ?? status.defaultName,
  }));
}

/**
 * Reads the Activity and Reminders payload defensively, like every other screen: one
 * unreadable key costs its own value, never the form.
 */
function toActivityGeneral(value: unknown): ActivityGeneralSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const d = ACTIVITY_GENERAL_DEFAULTS;
  const minutes = raw.overdueAfterMinutes;

  return {
    autoPromptFollowUpOnCompletion: bool(
      raw.autoPromptFollowUpOnCompletion,
      d.autoPromptFollowUpOnCompletion,
    ),
    followUpMandatoryOnStatusChange: bool(
      raw.followUpMandatoryOnStatusChange,
      d.followUpMandatoryOnStatusChange,
    ),
    remindersEnabled: bool(raw.remindersEnabled, d.remindersEnabled),
    reminderTime: oneOf(raw.reminderTime, REMINDER_TIME_KEYS, d.reminderTime),
    overdueMode: oneOf(raw.overdueMode, OVERDUE_MODES, d.overdueMode),
    overdueAfterMinutes:
      typeof minutes === 'number' &&
      (OVERDUE_MINUTES as readonly number[]).includes(minutes)
        ? (minutes as OverdueMinutes)
        : d.overdueAfterMinutes,
  };
}

/**
 * A stored follow-up type list back into rows. An entry without a usable id, name or
 * field set is dropped rather than repaired — half a configuration would drive half a
 * form, and the screen can always recreate the type.
 */
function toFollowUpTypes(value: unknown): FollowUpType[] {
  if (!Array.isArray(value)) return [];
  const types: FollowUpType[] = [];

  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;

    const id = typeof raw.id === 'string' ? raw.id : '';
    const name = text(raw.name, MAX_FOLLOW_UP_TYPE_NAME);
    if (id === '' || name === '') continue;

    const fields = toFollowUpFields(raw.fields);
    if (fields.length === 0) continue;

    types.push({
      id,
      name,
      isActive: bool(raw.isActive, true),
      activityType:
        raw.activityType === 'CALL' ||
        raw.activityType === 'MEETING' ||
        raw.activityType === 'TASK'
          ? raw.activityType
          : null,
      createdBy: text(raw.createdBy, 120),
      createdAt:
        typeof raw.createdAt === 'string' &&
        !Number.isNaN(Date.parse(raw.createdAt))
          ? raw.createdAt
          : new Date(0).toISOString(),
      fields,
    });
  }

  return types;
}

/** Stored field rows: known keys only, deduped, renumbered from the stored order. */
function toFollowUpFields(value: unknown): FollowUpTypeField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: { key: FollowUpFieldKey; position: number }[] = [];

  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    const key = raw.key;
    if (
      typeof key !== 'string' ||
      !(FOLLOW_UP_FIELD_KEYS as readonly string[]).includes(key) ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    rows.push({
      key: key as FollowUpFieldKey,
      position: typeof raw.position === 'number' ? raw.position : rows.length,
    });
  }

  return rows
    .sort((a, b) => a.position - b.position)
    .map((row, index) => ({ key: row.key, position: index + 1 }));
}

/**
 * The cross-field rules of the field builder: a field is selected once, the five the
 * create API requires stay selected, and the saved positions are renumbered 1..n so the
 * stored order is contiguous whatever the client sent.
 */
function normaliseFollowUpFields(
  fields: FollowUpTypeFieldDto[],
): FollowUpTypeField[] {
  const keys = fields.map((field) => field.key);
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('A field can be selected only once.');
  }

  const missing = REQUIRED_FOLLOW_UP_FIELDS.filter(
    (key) => !keys.includes(key),
  );
  if (missing.length > 0) {
    const labels = missing.map(
      (key) =>
        FOLLOW_UP_FIELDS.find((field) => field.key === key)?.label ?? key,
    );
    throw new BadRequestException(
      `${labels.join(', ')} must stay selected — a follow-up cannot be created without ${missing.length === 1 ? 'it' : 'them'}.`,
    );
  }

  return [...fields]
    .sort((a, b) => a.position - b.position)
    .map((field, index) => ({ key: field.key, position: index + 1 }));
}

/** Two types with the same name are one type twice; the table shows only the name. */
function assertNameFree(
  types: FollowUpType[],
  name: string,
  ignoreId: string | null,
): void {
  const taken = types.some(
    (type) =>
      type.id !== ignoreId && type.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) {
    throw new ConflictException(`${name} is already a follow up type.`);
  }
}
