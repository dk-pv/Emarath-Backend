import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';

/** The `app_settings` row this screen owns. */
export const ASSIGNMENT_GENERAL_KEY = 'assignment.general';

/** The reference's "Lead Assignment Limit Method" dropdown shows one option. */
export const LEAD_LIMIT_METHODS = ['GLOBAL'] as const;
export type LeadLimitMethod = (typeof LEAD_LIMIT_METHODS)[number];

/** The re-check time control is 12-hour, like the Organization shift times. */
export const MERIDIEMS = ['AM', 'PM'] as const;
export type Meridiem = (typeof MERIDIEMS)[number];

export const MIN_RECHECK_HOUR = 1;
export const MAX_RECHECK_HOUR = 12;
export const MIN_RECHECK_MINUTE = 0;
export const MAX_RECHECK_MINUTE = 59;

export const MIN_DAILY_LEAD_LIMIT = 1;
/** No tenant assigns more than this in a day; guards the int column from abuse. */
export const MAX_DAILY_LEAD_LIMIT = 100_000;

export interface AssignmentGeneralSettings {
  automaticLeadAssigning: boolean;

  carryoverLeads: boolean;
  includeFollowUpLeadsInCarryover: boolean;
  checkUserLoggedInBeforeAssigning: boolean;
  /** The re-check time; null throughout when the reference's clear × is used. */
  recheckHour: number | null;
  recheckMinute: number | null;
  recheckPeriod: Meridiem | null;

  leadAssignmentLimitEnabled: boolean;
  leadLimitMethod: LeadLimitMethod;
  dailyLeadLimit: number | null;

  whatsappRoundRobin: boolean;
  saveFirstIncomingMessageAsNote: boolean;
}

/**
 * The reference's own opening state: automatic assigning on, everything else off, and the
 * re-check control showing 12:00 AM once carryover reveals it.
 *
 * Automatic assigning defaults on because that is what the capture shows, and it is inert
 * until an active rule exists — the engine does nothing without one, so the default cannot
 * change how a fresh tenant's leads are created.
 */
export const ASSIGNMENT_GENERAL_DEFAULTS: AssignmentGeneralSettings = {
  automaticLeadAssigning: true,
  carryoverLeads: false,
  includeFollowUpLeadsInCarryover: false,
  checkUserLoggedInBeforeAssigning: false,
  recheckHour: 12,
  recheckMinute: 0,
  recheckPeriod: 'AM',
  leadAssignmentLimitEnabled: false,
  leadLimitMethod: 'GLOBAL',
  dailyLeadLimit: null,
  whatsappRoundRobin: false,
  saveFirstIncomingMessageAsNote: false,
};

/**
 * Every field is sent on every save — the row is replaced wholesale, as the other settings
 * screens are. Dependent fields are kept even while their parent toggle is off: clearing
 * what is merely hidden would silently discard a choice, so turning carryover off and on
 * again would lose the time that was set.
 *
 * The one rule that is genuinely conditional is the daily limit, which the reference
 * itself enforces with "Daily lead limit must be greater than 0." — and only while the
 * limit is switched on, since a hidden field has nothing to be greater than 0.
 */
export class UpdateAssignmentGeneralDto {
  @IsBoolean()
  automaticLeadAssigning!: boolean;

  @IsBoolean()
  carryoverLeads!: boolean;

  @IsBoolean()
  includeFollowUpLeadsInCarryover!: boolean;

  @IsBoolean()
  checkUserLoggedInBeforeAssigning!: boolean;

  @ValidateIf((dto: UpdateAssignmentGeneralDto) => dto.recheckHour !== null)
  @Type(() => Number)
  @IsInt()
  @Min(MIN_RECHECK_HOUR)
  @Max(MAX_RECHECK_HOUR)
  recheckHour!: number | null;

  @ValidateIf((dto: UpdateAssignmentGeneralDto) => dto.recheckMinute !== null)
  @Type(() => Number)
  @IsInt()
  @Min(MIN_RECHECK_MINUTE)
  @Max(MAX_RECHECK_MINUTE)
  recheckMinute!: number | null;

  @ValidateIf((dto: UpdateAssignmentGeneralDto) => dto.recheckPeriod !== null)
  @IsIn([...MERIDIEMS])
  recheckPeriod!: Meridiem | null;

  @IsBoolean()
  leadAssignmentLimitEnabled!: boolean;

  @IsIn([...LEAD_LIMIT_METHODS])
  leadLimitMethod!: LeadLimitMethod;

  /** The reference's own message, enforced here as well as in the form. */
  @ValidateIf(
    (dto: UpdateAssignmentGeneralDto) => dto.leadAssignmentLimitEnabled,
  )
  @Type(() => Number)
  @IsInt({ message: 'Daily lead limit must be greater than 0.' })
  @Min(MIN_DAILY_LEAD_LIMIT, {
    message: 'Daily lead limit must be greater than 0.',
  })
  @Max(MAX_DAILY_LEAD_LIMIT)
  dailyLeadLimit!: number | null;

  @IsBoolean()
  whatsappRoundRobin!: boolean;

  @IsBoolean()
  saveFirstIncomingMessageAsNote!: boolean;
}
