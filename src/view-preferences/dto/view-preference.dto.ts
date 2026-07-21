import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';

/**
 * A saved table layout: the manageable column ids in the user's chosen order,
 * and the subset currently hidden. The keys are the frontend's column ids; the
 * backend never interprets them, so the same shape serves any Manage Columns view.
 */
export interface ColumnLayout {
  order: string[];
  hidden: string[];
}

/**
 * Column ids are safe identifiers (`primaryPhone`, `actualAmount`, …), length-
 * capped so a saved layout can never bloat the row, and array-capped so a payload
 * cannot grow without bound. The client reconciles these against its live column
 * set on load, so an unknown or renamed key is dropped there, not enforced here.
 */
const COLUMN_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_COLUMNS = 200;

export class SaveViewPreferenceDto implements ColumnLayout {
  @IsArray()
  @ArrayMaxSize(MAX_COLUMNS)
  @IsString({ each: true })
  @Matches(COLUMN_KEY, { each: true })
  order!: string[];

  @IsArray()
  @ArrayMaxSize(MAX_COLUMNS)
  @IsString({ each: true })
  @Matches(COLUMN_KEY, { each: true })
  hidden!: string[];
}

/**
 * Which view a layout belongs to: kebab-case, length-capped. Validated because it
 * is a path segment that becomes part of the stored row's unique key — `leads`
 * today, `activities`/`kanban` when those Manage Columns drawers reuse the store.
 */
const VIEW_KEY = /^[a-z][a-z0-9-]{0,63}$/;

export function isViewKey(viewKey: string): boolean {
  return VIEW_KEY.test(viewKey);
}
