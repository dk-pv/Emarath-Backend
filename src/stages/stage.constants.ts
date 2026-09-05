/** The default board a bare stage query targets — the same default as `Lead.pipeline`. */
export const DEFAULT_PIPELINE = 'Lead Pipeline';

/**
 * The palette keys a stage colour may take (KAN-05.1).
 *
 * Framework-agnostic on purpose: the store holds a key (`violet`, `amber`, …), never
 * a CSS class, so the frontend maps the key to its own design tokens (badge / tint /
 * swatch / border) in KAN-05.2. The set is the hues the design system defines, so a
 * recolour can only pick a colour the views can actually render.
 */
export const STAGE_COLORS = [
  'violet',
  'cyan',
  'slate',
  'amber',
  'sky',
  'yellow',
  'purple',
  'teal',
  'rose',
  'blue',
  'red',
  'gray',
  'lime',
] as const;

export type StageColor = (typeof STAGE_COLORS)[number];

/**
 * The Sales Pipeline wizard's stage vocabulary (ADR-0060).
 *
 * Both sets are now taken from captures of the selects' OPEN panels, so each is complete
 * as far as the reference shows. The DTO, the API and the UI all read these constants, so
 * the frontend options and the accepted values cannot drift.
 */
export const STAGE_INCLUSIONS = [
  'INCLUDE_IN_SALES_PIPELINE',
  'EXCLUDE_FROM_SALES_PIPELINE',
] as const;
export type StageInclusion = (typeof STAGE_INCLUSIONS)[number];

/** Won / Lost / Ignore — the three the open outcome panel lists. */
export const STAGE_OUTCOMES = ['WON', 'LOST', 'IGNORE'] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

/**
 * Probability is a percentage. The reference shows the value `0` but never the control's
 * bounds, so 0-100 is a documented assumption rather than observed behaviour (ADR-0060).
 */
export const MIN_STAGE_PROBABILITY = 0;
export const MAX_STAGE_PROBABILITY = 100;
