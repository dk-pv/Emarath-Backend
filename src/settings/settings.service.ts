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
