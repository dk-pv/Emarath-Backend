import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** The two `app_settings` rows this category owns. */
export const ACTIVITY_GENERAL_KEY = 'activityReminders.general';
export const ACTIVITY_FOLLOW_UP_TYPES_KEY = 'activityReminders.followUpTypes';

/**
 * Reminder Time, transcribed from the reference's open dropdown. The label is the
 * screen's; `minutesBefore` is what a reminder engine would subtract from `dueAt` —
 * carried here so the vocabulary stays one list rather than a labels map beside an
 * offsets map. Nothing executes these yet (ADR-0071).
 */
export const REMINDER_TIMES = [
  { key: 'AT_TIME_OF_EVENT', label: 'At time of Event', minutesBefore: 0 },
  { key: 'MIN_5_BEFORE', label: '5 Minutes Before', minutesBefore: 5 },
  { key: 'MIN_15_BEFORE', label: '15 Minutes Before', minutesBefore: 15 },
  { key: 'MIN_30_BEFORE', label: '30 Minutes Before', minutesBefore: 30 },
  { key: 'HOUR_1_BEFORE', label: '1 Hour Before', minutesBefore: 60 },
  { key: 'HOUR_2_BEFORE', label: '2 Hour Before', minutesBefore: 120 },
] as const;

export type ReminderTime = (typeof REMINDER_TIMES)[number]['key'];

export const REMINDER_TIME_KEYS = REMINDER_TIMES.map(
  (option) => option.key,
) as readonly ReminderTime[];

/** "Make Appointment as Overdue" — the reference's two radio cards. */
export const OVERDUE_MODES = ['END_OF_DAY', 'CUSTOM_TIME_SPAN'] as const;
export type OverdueMode = (typeof OVERDUE_MODES)[number];

/** "Overdue After" — the four values the reference's dropdown offers, and no others. */
export const OVERDUE_MINUTES = [15, 30, 45, 60] as const;
export type OverdueMinutes = (typeof OVERDUE_MINUTES)[number];

export interface ActivityGeneralSettings {
  autoPromptFollowUpOnCompletion: boolean;
  followUpMandatoryOnStatusChange: boolean;
  remindersEnabled: boolean;
  reminderTime: ReminderTime;
  overdueMode: OverdueMode;
  overdueAfterMinutes: OverdueMinutes;
}

/**
 * The state the reference's primary capture is in: both workflow prompts on, reminders on
 * at the time of the event, and appointments going overdue 15 minutes after they were
 * due. A later capture shows the same screen with reminders off and End of Day selected —
 * that is a configured tenant, not a second default.
 */
export const ACTIVITY_GENERAL_DEFAULTS: ActivityGeneralSettings = {
  autoPromptFollowUpOnCompletion: true,
  followUpMandatoryOnStatusChange: true,
  remindersEnabled: true,
  reminderTime: 'AT_TIME_OF_EVENT',
  overdueMode: 'CUSTOM_TIME_SPAN',
  overdueAfterMinutes: 15,
};

/**
 * The follow-up form's field catalogue — the seven the reference's builder lists, and
 * nothing else. Each one is a real column on `Activity`, which is why the list is closed:
 * a key the form cannot render is a key the API cannot store.
 */
export const FOLLOW_UP_FIELDS = [
  { key: 'DESCRIPTION', label: 'Description' },
  { key: 'ASSIGNED_TO', label: 'Assigned To' },
  { key: 'LEAD_NAME', label: 'Lead Name' },
  { key: 'DUE_DATE', label: 'Due Date' },
  { key: 'START_TIME', label: 'Start Time' },
  { key: 'END_TIME', label: 'End Time' },
  { key: 'LOCATION', label: 'Location' },
] as const;

export type FollowUpFieldKey = (typeof FOLLOW_UP_FIELDS)[number]['key'];

export const FOLLOW_UP_FIELD_KEYS = FOLLOW_UP_FIELDS.map(
  (field) => field.key,
) as readonly FollowUpFieldKey[];

/**
 * The five `CreateActivityDto` refuses to create a follow-up without. They are always
 * selected, so a configuration cannot produce a form that cannot be submitted (ADR-0071).
 * They reorder freely; only End Time and Location move between the panels — which is the
 * split the reference's own two panels draw.
 */
export const REQUIRED_FOLLOW_UP_FIELDS: readonly FollowUpFieldKey[] = [
  'DESCRIPTION',
  'ASSIGNED_TO',
  'LEAD_NAME',
  'DUE_DATE',
  'START_TIME',
];

export const MAX_FOLLOW_UP_TYPE_NAME = 60;
/** The row holds the whole list, so it needs a ceiling (the Host Mapping rule). */
export const MAX_FOLLOW_UP_TYPES = 50;

export interface FollowUpTypeField {
  key: FollowUpFieldKey;
  /** 1-based and contiguous — the order the follow-up form renders. */
  position: number;
}

export interface FollowUpType {
  id: string;
  name: string;
  isActive: boolean;
  /**
   * The `ActivityType` a follow-up of this type is stored as. Non-null only for the three
   * shipped types, which are the enum. A custom type has no enum value to store, so it is
   * configuration until `Activity.type` gains one (ADR-0071).
   */
  activityType: 'CALL' | 'MEETING' | 'TASK' | null;
  /** What the reference's "Created By" column prints. */
  createdBy: string;
  /** ISO-8601, what the "Date and Time" column prints. */
  createdAt: string;
  fields: FollowUpTypeField[];
}

const positioned = (keys: readonly FollowUpFieldKey[]): FollowUpTypeField[] =>
  keys.map((key, index) => ({ key, position: index + 1 }));

/**
 * The three types the reference's table ships with, bound to the three `ActivityType`
 * values the Add Follow-up drawer already offers. Their field sets are not invented: a
 * Call carries neither an End Time nor a Location (`ActivitiesService.assertTypeShape`),
 * and a Meeting and a Task carry both.
 */
export const SHIPPED_FOLLOW_UP_TYPES: readonly Omit<
  FollowUpType,
  'id' | 'createdAt'
>[] = [
  {
    name: 'Call',
    isActive: true,
    activityType: 'CALL',
    createdBy: 'ADMIN',
    fields: positioned(REQUIRED_FOLLOW_UP_FIELDS),
  },
  {
    name: 'Meeting',
    isActive: true,
    activityType: 'MEETING',
    createdBy: 'ADMIN',
    fields: positioned([...REQUIRED_FOLLOW_UP_FIELDS, 'END_TIME', 'LOCATION']),
  },
  {
    name: 'Task',
    isActive: true,
    activityType: 'TASK',
    createdBy: 'ADMIN',
    fields: positioned([...REQUIRED_FOLLOW_UP_FIELDS, 'END_TIME', 'LOCATION']),
  },
];

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** General Settings. Every field is required: Save replaces the whole row. */
export class UpdateActivityGeneralDto {
  @IsBoolean()
  autoPromptFollowUpOnCompletion!: boolean;

  @IsBoolean()
  followUpMandatoryOnStatusChange!: boolean;

  @IsBoolean()
  remindersEnabled!: boolean;

  @IsIn(REMINDER_TIME_KEYS, { message: 'Select a valid Reminder Time.' })
  reminderTime!: ReminderTime;

  @IsIn(OVERDUE_MODES, { message: 'Select a valid overdue rule.' })
  overdueMode!: OverdueMode;

  @IsIn(OVERDUE_MINUTES, { message: 'Select a valid Overdue After value.' })
  overdueAfterMinutes!: OverdueMinutes;
}

/** One row of the field builder's Selected panel. */
export class FollowUpTypeFieldDto {
  @IsIn(FOLLOW_UP_FIELD_KEYS, { message: 'Unknown follow-up form field.' })
  key!: FollowUpFieldKey;

  @IsInt()
  position!: number;
}

/**
 * The Add / Edit Follow Up Type form's payload. The service owns the cross-field rules
 * (no duplicate key, contiguous positions, the required five present), because they are
 * about the set rather than any one member.
 */
export class SaveFollowUpTypeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Follow Up Type Name is required.' })
  @MaxLength(MAX_FOLLOW_UP_TYPE_NAME)
  name!: string;

  @IsBoolean()
  isActive!: boolean;

  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one field.' })
  @ArrayMaxSize(FOLLOW_UP_FIELDS.length)
  @ValidateNested({ each: true })
  @Type(() => FollowUpTypeFieldDto)
  fields!: FollowUpTypeFieldDto[];
}

/**
 * What the follow-up form itself needs at runtime: the workflow switches plus the active
 * types and their field order. Readable by any authenticated user — an agent's Add
 * Follow-up drawer cannot honour a configuration it is forbidden to read — while every
 * mutation stays `SUPERADMIN` (ADR-0071).
 */
export interface ActivityWorkflowSettings {
  general: ActivityGeneralSettings;
  followUpTypes: FollowUpType[];
}
