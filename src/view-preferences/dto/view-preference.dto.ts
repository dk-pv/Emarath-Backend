import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * A saved table layout: the manageable column ids in the user's chosen order,
 * and the subset currently hidden. The keys are the frontend's column ids; the
 * backend never interprets them, so the same shape serves any Manage Columns view.
 */
export interface ColumnLayout {
  order: string[];
  hidden: string[];
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Kanban stage-pin preference (KAN-05.2): per pipeline, the one stage the caller
 * has pinned (rendered as a sticky/frozen column). Stored per-user in the same
 * `UserViewPreference` table under the fixed `kanban-pins` key. A pipeline absent from
 * the map has no pinned stage; one pin per pipeline (a new pin replaces the previous).
 */
export interface KanbanPins {
  pins: Record<string, string>;
}

/**
 * Pin — or unpin — one stage of a pipeline. `stage` present pins it (replacing any
 * previous pin in that pipeline); `stage` omitted or empty unpins the pipeline. Names
 * carry spaces/punctuation ("SUPER HOT", "QC NOT APPROVED - WON"), so they are length-
 * bounded rather than pattern-matched like the safe column-id keys above.
 */
export class SetKanbanPinDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'pipeline is required' })
  @MaxLength(64)
  pipeline!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  stage?: string;
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
