import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The `app_settings` rows this module owns. */
export const CALL_TRACKING_GENERAL_KEY = 'callTracking.general';
export const CALL_TRACKING_STATUSES_KEY = 'callTracking.callStatuses';

/**
 * The reference shows the product's own name selected in both Call Type fields
 * ("Workpex"), rebranded here as the one thing CLAUDE.md §1 allows to differ.
 *
 * It never shows either dropdown open, so this is the only option evidence exists for.
 * A second provider is one entry in this array — the value is validated against it on
 * both sides, so nothing drifts when one arrives (ADR-0070).
 */
export const CALL_TYPES = ['EMARATH'] as const;
export type CallType = (typeof CALL_TYPES)[number];

/** Both options are captured, in the reference's own order. */
export const CALL_PROVIDER_MODES = ['TOTAL_CALLS', 'UNIQUE_CALLS'] as const;
export type CallProviderMode = (typeof CALL_PROVIDER_MODES)[number];

export interface CallTrackingGeneralSettings {
  /** Null when the reference's clear × is used; the fields are clearable. */
  outgoingCallType: CallType | null;
  incomingCallType: CallType | null;
  callProviderMode: CallProviderMode | null;
}

/** The reference's own state: both call types set, provider mode on Unique Calls. */
export const CALL_TRACKING_GENERAL_DEFAULTS: CallTrackingGeneralSettings = {
  outgoingCallType: 'EMARATH',
  incomingCallType: 'EMARATH',
  callProviderMode: 'UNIQUE_CALLS',
};

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Every field is sent on every save — the row is replaced wholesale, as the other
 * settings screens are. `null` is a value here, not an omission: each control carries a
 * clear ×, so "no call type chosen" has to be expressible.
 */
export class UpdateCallTrackingGeneralDto {
  @IsIn([...CALL_TYPES, null], {
    message: 'Choose an outgoing call type from the list.',
  })
  outgoingCallType!: CallType | null;

  @IsIn([...CALL_TYPES, null], {
    message: 'Choose an incoming call type from the list.',
  })
  incomingCallType!: CallType | null;

  @IsIn([...CALL_PROVIDER_MODES, null], {
    message: 'Call Provider Mode must be Total Calls or Unique Calls.',
  })
  callProviderMode!: CallProviderMode | null;
}

// ---------------------------------------------------------------------------------------

/**
 * The six statuses the reference's Call Status table lists, in its order.
 *
 * These are the **provider's** dial statuses, not Emarath's `CallOutcome`. The enum the
 * Call model stores has three values (`ANSWERED`, `NO_ANSWER`, `BUSY`) because those are
 * what the Call Dashboard aggregates on; the other three are states a PBX reports that
 * Emarath has never needed to store. This screen renames what the six are *called*, and
 * touches neither the enum nor a single call row (ADR-0070).
 *
 * `key` is the immutable provider status. `defaultName` is the label the reference prints
 * in its first column, which is also what a custom name starts as.
 */
export const CALL_PROVIDER_STATUSES = [
  { key: 'ANSWERED', defaultName: 'ANSWERED' },
  { key: 'BUSY', defaultName: 'BUSY' },
  { key: 'NO_ANSWER', defaultName: 'NO ANSWER' },
  { key: 'CONGESTION', defaultName: 'CONGESTION' },
  { key: 'CHANUNAVAIL', defaultName: 'CHAN UN AVAIL' },
  { key: 'CANCEL', defaultName: 'CANCEL' },
] as const;

export type CallProviderStatusKey =
  (typeof CALL_PROVIDER_STATUSES)[number]['key'];

export const CALL_PROVIDER_STATUS_KEYS: readonly string[] =
  CALL_PROVIDER_STATUSES.map((status) => status.key);

/** Long enough for a real company label, bounded like every other name in the schema. */
export const MAX_CUSTOM_STATUS_NAME = 60;

export interface CallStatusRow {
  /** The provider status. Immutable: the reference's first column has no edit control. */
  providerStatus: CallProviderStatusKey;
  defaultName: string;
  customName: string;
}

/** Untouched, every custom name is its default — exactly what the reference shows. */
export const CALL_STATUS_DEFAULTS: CallStatusRow[] = CALL_PROVIDER_STATUSES.map(
  (status) => ({
    providerStatus: status.key,
    defaultName: status.defaultName,
    customName: status.defaultName,
  }),
);

/** One row's editable half. The provider status travels in the path, never the body. */
export class UpdateCallStatusDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Custom Status Name is required.' })
  @MaxLength(MAX_CUSTOM_STATUS_NAME)
  customName!: string;
}
