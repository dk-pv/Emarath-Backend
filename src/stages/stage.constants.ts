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
