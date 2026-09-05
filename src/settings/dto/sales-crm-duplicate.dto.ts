import { IsBoolean, IsIn } from 'class-validator';

/** The `app_settings` row this screen owns. */
export const SALES_CRM_DUPLICATE_KEY = 'sales-crm.duplicate';

/**
 * What happens once a duplicate is detected — the reference's two radio cards.
 *
 * The matching *fields* are not configurable (primary phone, secondary phone, email);
 * only the outcome is, which is exactly what the reference's banner states.
 */
export const DUPLICATE_MODES = ['WARN_ALLOW_SAVE', 'BLOCK_HARD_STOP'] as const;
export type DuplicateMode = (typeof DUPLICATE_MODES)[number];

/** How many change entries the log keeps, so the JSON row stays bounded. */
export const DUPLICATE_LOG_LIMIT = 50;

/** One recorded configuration change — what the reference's Activity Log lists. */
export interface DuplicateSettingsLogEntry {
  at: string;
  byName: string | null;
  /** One human sentence per field that actually changed. */
  changes: string[];
}

export interface SalesCrmDuplicateSettings {
  mode: DuplicateMode;
  /** Warn mode only: "Ability to search and view Duplicate leads". */
  allowDuplicateSearch: boolean;
  /** Block mode only: "Display Assignee Information for Duplicate Leads". */
  displayAssigneeInfo: boolean;
  /** Block mode only: "Check archived leads for duplicates?". */
  checkArchivedLeads: boolean;
  /** Newest first. Read-only from the client's point of view. */
  log: DuplicateSettingsLogEntry[];
}

/**
 * The shipped defaults, taken from the reference's own state: Warn selected, the warn
 * toggle on, and both block toggles off.
 */
export const SALES_CRM_DUPLICATE_DEFAULTS: SalesCrmDuplicateSettings = {
  mode: 'WARN_ALLOW_SAVE',
  allowDuplicateSearch: true,
  displayAssigneeInfo: false,
  checkArchivedLeads: false,
  log: [],
};

export class UpdateSalesCrmDuplicateDto {
  @IsIn([...DUPLICATE_MODES], {
    message: 'Choose either Warn, allow save or Block, hard stop.',
  })
  mode!: DuplicateMode;

  @IsBoolean()
  allowDuplicateSearch!: boolean;

  @IsBoolean()
  displayAssigneeInfo!: boolean;

  @IsBoolean()
  checkArchivedLeads!: boolean;
}

/** One lead the new enquiry matched, and why. */
export class DuplicateMatchDto {
  id!: string;
  name!: string;
  /** `primaryPhone` | `secondaryPhone` | `email` — the field that matched. */
  matchedOn!: string;
  /**
   * Present only while "Display Assignee Information for Duplicate Leads" is on. The
   * backend omits the key entirely when the setting is off, so the information cannot
   * leak through a field the client simply chooses not to render.
   */
  assignees?: string[];
}

/** What a blocked enquiry answers with — a 409 body the form can render. */
export interface BlockedDuplicateResponse {
  message: string;
  mode: DuplicateMode;
  matches: DuplicateMatchDto[];
}
