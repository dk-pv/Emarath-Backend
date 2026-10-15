import { IsBoolean } from 'class-validator';

/** The `app_settings` row this screen owns. */
export const SALES_CRM_DUPLICATE_KEY = 'sales-crm.duplicate';

/** How many change entries the log keeps, so the JSON row stays bounded. */
export const DUPLICATE_LOG_LIMIT = 50;

/** One recorded configuration change — what the reference's Activity Log lists. */
export interface DuplicateSettingsLogEntry {
  at: string;
  byName: string | null;
  /** One human sentence per field that actually changed. */
  changes: string[];
}

/**
 * Duplicate handling has no mode (ADR-0092). A duplicate is always created as its own lead and
 * linked to the lead it duplicates; the matching fields (primary phone, secondary phone, email)
 * are fixed. Only two things remain configurable, and neither can stop a lead being created.
 *
 * Earlier versions also stored `mode` (Warn | Block) and `displayAssigneeInfo` (a Block-only
 * detail). A stored row may still carry them; they are ignored on read and dropped the next
 * time the screen is saved, so a legacy Block setting can never refuse a lead.
 */
export interface SalesCrmDuplicateSettings {
  /** "Ability to search and view Duplicate leads". */
  allowDuplicateSearch: boolean;
  /** "Check archived leads for duplicates?" — whether an archived lead can be the original. */
  checkArchivedLeads: boolean;
  /** Newest first. Read-only from the client's point of view. */
  log: DuplicateSettingsLogEntry[];
}

/** The shipped defaults, from the reference's own state: the search toggle on, archived off. */
export const SALES_CRM_DUPLICATE_DEFAULTS: SalesCrmDuplicateSettings = {
  allowDuplicateSearch: true,
  checkArchivedLeads: false,
  log: [],
};

/**
 * What the screen submits. Under `forbidNonWhitelisted`, a body that still names `mode` (the
 * removed Block option) or `displayAssigneeInfo` is a 400 — a client cannot configure duplicate
 * handling to refuse leads.
 */
export class UpdateSalesCrmDuplicateDto {
  @IsBoolean()
  allowDuplicateSearch!: boolean;

  @IsBoolean()
  checkArchivedLeads!: boolean;
}
