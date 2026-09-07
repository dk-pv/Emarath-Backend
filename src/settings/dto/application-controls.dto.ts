import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

/** The two `app_settings` rows this category owns. */
export const APPLICATION_GENERAL_KEY = 'application.general';
export const APPLICATION_DASHBOARD_KEY = 'application.dashboard';

/* -------------------------------------------------------------------------- */
/* Application General Settings                                               */
/* -------------------------------------------------------------------------- */

export interface ApplicationGeneralSettings {
  autoSavePassword: boolean;
  disablePromptAfterCall: boolean;
  selfieVerificationOnLogin: boolean;
}

/** Every switch is drawn grey and off in the reference. */
export const APPLICATION_GENERAL_DEFAULTS: ApplicationGeneralSettings = {
  autoSavePassword: false,
  disablePromptAfterCall: false,
  selfieVerificationOnLogin: false,
};

/**
 * Settings → Application Controls → Application General Settings.
 *
 * Three switches, so three booleans. Only `autoSavePassword` has a consumer today —
 * the login form's password autocomplete. The other two are stored policy with no
 * mechanism behind them yet: this codebase has no after-call prompt and no identity
 * verification of any kind, and inventing either to make a switch look live is exactly
 * what CLAUDE.md §16/§20 forbid (ADR-0074).
 */
export class UpdateApplicationGeneralDto {
  @IsBoolean()
  autoSavePassword!: boolean;

  @IsBoolean()
  disablePromptAfterCall!: boolean;

  @IsBoolean()
  selfieVerificationOnLogin!: boolean;
}

/** What the login screen is allowed to know before anyone has authenticated. */
export interface LoginPolicy {
  autoSavePassword: boolean;
}

/* -------------------------------------------------------------------------- */
/* Dashboard Settings                                                          */
/* -------------------------------------------------------------------------- */

export const SUMMARY_MODES = ['LEAD_STAGE', 'LEAD_SOURCE'] as const;
export type SummaryMode = (typeof SUMMARY_MODES)[number];

export const DISPLAY_ON_CARDS = ['BOTH', 'LEAD_COUNT', 'AMOUNT'] as const;
export type DisplayOnCards = (typeof DISPLAY_ON_CARDS)[number];

/**
 * A summary card's identity is the stage or source **name**.
 *
 * That is not a label standing in for a key: `Lead.status` stores the stage name
 * verbatim and `Lead.source` stores the source name verbatim (KAN-05.1, ADR-0060), so
 * the name *is* the value the dashboard groups by. A renamed stage renames its leads
 * with it, which is why the catalogues carry no separate id in lead rows.
 */
export interface DashboardCardConfig {
  fieldKey: string;
  position: number;
}

export interface DashboardSettings {
  summaryMode: SummaryMode;
  displayOnCards: DisplayOnCards;
  /** Mode-separated selections: switching mode never disturbs the other's list. */
  leadStage: DashboardCardConfig[];
  leadSource: DashboardCardConfig[];
}

/**
 * First-time defaults only. Lead Stage with Lead Count is what the reference opens on;
 * neither list is pre-filled, because which stages a company summarises is its own
 * decision and no screenshot shows a shipped selection.
 */
export const APPLICATION_DASHBOARD_DEFAULTS: DashboardSettings = {
  summaryMode: 'LEAD_STAGE',
  displayOnCards: 'LEAD_COUNT',
  leadStage: [],
  leadSource: [],
};

/** A guard against a runaway payload; far above any real catalogue. */
export const MAX_DASHBOARD_CARDS = 100;
export const MAX_CARD_KEY = 64;

export class DashboardCardDto {
  @IsString()
  @Length(1, MAX_CARD_KEY)
  fieldKey!: string;

  @IsInt()
  @Min(1)
  position!: number;
}

export class UpdateDashboardSettingsDto {
  @IsIn(SUMMARY_MODES)
  summaryMode!: SummaryMode;

  @IsIn(DISPLAY_ON_CARDS)
  displayOnCards!: DisplayOnCards;

  @IsArray()
  @ArrayMaxSize(MAX_DASHBOARD_CARDS)
  @ValidateNested({ each: true })
  @Type(() => DashboardCardDto)
  leadStage!: DashboardCardDto[];

  @IsArray()
  @ArrayMaxSize(MAX_DASHBOARD_CARDS)
  @ValidateNested({ each: true })
  @Type(() => DashboardCardDto)
  leadSource!: DashboardCardDto[];
}

/** One selectable option, as both panels of the builder list it. */
export interface DashboardFieldOption {
  fieldKey: string;
  label: string;
}

export interface DashboardFieldCatalogue {
  leadStage: DashboardFieldOption[];
  leadSource: DashboardFieldOption[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** A stored payload widened back to the settings shape, defaults filling any gap. */
export function toApplicationGeneral(
  value: unknown,
): ApplicationGeneralSettings {
  const stored = asRecord(value);
  return {
    autoSavePassword: asBoolean(
      stored.autoSavePassword,
      APPLICATION_GENERAL_DEFAULTS.autoSavePassword,
    ),
    disablePromptAfterCall: asBoolean(
      stored.disablePromptAfterCall,
      APPLICATION_GENERAL_DEFAULTS.disablePromptAfterCall,
    ),
    selfieVerificationOnLogin: asBoolean(
      stored.selfieVerificationOnLogin,
      APPLICATION_GENERAL_DEFAULTS.selfieVerificationOnLogin,
    ),
  };
}

/**
 * A stored payload widened back to the settings shape.
 *
 * Cards are re-sorted and re-numbered on the way out as well as in, so a row written
 * before a validation rule existed can still only produce a dense 1..n order.
 */
export function toDashboardSettings(value: unknown): DashboardSettings {
  const stored = asRecord(value);
  const mode = SUMMARY_MODES.find((m) => m === stored.summaryMode);
  const display = DISPLAY_ON_CARDS.find((d) => d === stored.displayOnCards);

  return {
    summaryMode: mode ?? APPLICATION_DASHBOARD_DEFAULTS.summaryMode,
    displayOnCards: display ?? APPLICATION_DASHBOARD_DEFAULTS.displayOnCards,
    leadStage: normaliseCards(stored.leadStage),
    leadSource: normaliseCards(stored.leadSource),
  };
}

/** Sorted by stored position, then renumbered 1..n — no gaps, no duplicates. */
export function normaliseCards(value: unknown): DashboardCardConfig[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value
    .map((entry) => asRecord(entry))
    .filter(
      (entry): entry is { fieldKey: string; position: unknown } =>
        typeof entry.fieldKey === 'string' && entry.fieldKey.length > 0,
    )
    .filter((entry) => {
      if (seen.has(entry.fieldKey)) return false;
      seen.add(entry.fieldKey);
      return true;
    })
    .map((entry, index) => ({
      fieldKey: entry.fieldKey,
      position: typeof entry.position === 'number' ? entry.position : index + 1,
    }))
    .sort((a, b) => a.position - b.position)
    .map((entry, index) => ({ fieldKey: entry.fieldKey, position: index + 1 }));
}
