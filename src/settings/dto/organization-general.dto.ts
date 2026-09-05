import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { CURRENCY_CODES } from '../../lookups/lookups.data';

/** The `app_settings` row this screen owns. */
export const ORGANIZATION_GENERAL_KEY = 'organization.general';

/**
 * The reference's "Date Display Format" list, in its order. These are PHP-style date
 * tokens, which is what Workpex prints; the value is stored verbatim.
 */
export const DATE_DISPLAY_FORMATS = [
  'D, d M Y',
  'd-m-Y',
  'd/m/Y',
  'm-d-Y',
  'm/d/Y',
  'Y-m-d',
  'Y/m/d',
  'Y-d-m',
  'Y/d/m',
] as const;
export type DateDisplayFormat = (typeof DATE_DISPLAY_FORMATS)[number];

/** The reference's "Table Pagination Limits" options. */
export const PAGINATION_LIMITS = [10, 20, 50, 100] as const;
export type PaginationLimit = (typeof PAGINATION_LIMITS)[number];

/** The reference's Off Days list, Sunday first as the dropdown shows it. */
export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MERIDIEMS = ['AM', 'PM'] as const;
export type Meridiem = (typeof MERIDIEMS)[number];

/** The reference's shift controls are 12-hour: 1–12, 00–59, AM/PM. */
export const MIN_SHIFT_HOUR = 1;
export const MAX_SHIFT_HOUR = 12;
export const MIN_SHIFT_MINUTE = 0;
export const MAX_SHIFT_MINUTE = 59;

export interface OrganizationGeneralSettings {
  currency: string;
  dateDisplayFormat: DateDisplayFormat;
  tablePaginationLimit: PaginationLimit;
  organizationalGrouping: boolean;
  shiftStartHour: number;
  shiftStartMinute: number;
  shiftStartPeriod: Meridiem;
  shiftEndHour: number;
  shiftEndMinute: number;
  shiftEndPeriod: Meridiem;
  offDays: Weekday[];
  productModuleEnabled: boolean;
}

/** The reference's own state: AED, d-m-Y, 100 rows, 10:00 AM–7:00 PM, Sunday off. */
export const ORGANIZATION_GENERAL_DEFAULTS: OrganizationGeneralSettings = {
  currency: 'AED',
  dateDisplayFormat: 'd-m-Y',
  tablePaginationLimit: 100,
  organizationalGrouping: false,
  shiftStartHour: 10,
  shiftStartMinute: 0,
  shiftStartPeriod: 'AM',
  shiftEndHour: 7,
  shiftEndMinute: 0,
  shiftEndPeriod: 'PM',
  offDays: ['Sunday'],
  productModuleEnabled: false,
};

export class UpdateOrganizationGeneralDto {
  /** Validated against the same catalogue the Currency dropdown reads. */
  @IsIn([...CURRENCY_CODES], { message: 'Choose a currency from the list.' })
  currency!: string;

  @IsIn([...DATE_DISPLAY_FORMATS], {
    message: 'Choose a date format from the list.',
  })
  dateDisplayFormat!: DateDisplayFormat;

  @IsIn([...PAGINATION_LIMITS], {
    message: 'Table pagination limit must be 10, 20, 50 or 100.',
  })
  tablePaginationLimit!: PaginationLimit;

  @IsBoolean()
  organizationalGrouping!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_SHIFT_HOUR)
  @Max(MAX_SHIFT_HOUR)
  shiftStartHour!: number;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_SHIFT_MINUTE)
  @Max(MAX_SHIFT_MINUTE)
  shiftStartMinute!: number;

  @IsIn([...MERIDIEMS])
  shiftStartPeriod!: Meridiem;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_SHIFT_HOUR)
  @Max(MAX_SHIFT_HOUR)
  shiftEndHour!: number;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_SHIFT_MINUTE)
  @Max(MAX_SHIFT_MINUTE)
  shiftEndMinute!: number;

  @IsIn([...MERIDIEMS])
  shiftEndPeriod!: Meridiem;

  /** A day cannot be chosen twice, and there are only seven of them. */
  @IsArray()
  @ArrayMaxSize(WEEKDAYS.length)
  @ArrayUnique()
  @IsIn([...WEEKDAYS], {
    each: true,
    message: 'Off days must be weekday names.',
  })
  offDays!: Weekday[];

  @IsBoolean()
  productModuleEnabled!: boolean;
}

/** 12-hour clock to minutes past midnight, so two shift times can be compared. */
export function toMinutes(
  hour: number,
  minute: number,
  period: Meridiem,
): number {
  // 12 AM is midnight and 12 PM is noon, so the 12 folds to 0 before the PM offset.
  const base = (hour % 12) + (period === 'PM' ? 12 : 0);
  return base * 60 + minute;
}
