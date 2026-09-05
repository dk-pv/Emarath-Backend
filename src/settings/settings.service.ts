import { Injectable } from '@nestjs/common';
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
