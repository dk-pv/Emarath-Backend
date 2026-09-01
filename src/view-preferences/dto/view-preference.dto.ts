import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

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
/**
 * The Lead Aging report's banding thresholds (RPT-02.8), in days: leads up to `green`
 * are healthy, up to `amber` need attention, and anything older is stale. Stored per user
 * in the same `UserViewPreference` table under the fixed `lead-aging-thresholds` key, as
 * the Kanban pins are — a report preference, not a table layout.
 */
export interface AgingThresholds {
  green: number;
  amber: number;
}

/** Both bounds are whole days; amber must sit above green, and a year caps both. */
export class SetAgingThresholdsDto implements AgingThresholds {
  @Type(() => Number)
  @IsInt({ message: 'green must be an integer' })
  @Min(1, { message: 'green must be 1 or greater' })
  @Max(365, { message: 'green must be at most 365' })
  green!: number;

  @Type(() => Number)
  @IsInt({ message: 'amber must be an integer' })
  @Min(2, { message: 'amber must be 2 or greater' })
  @Max(365, { message: 'amber must be at most 365' })
  amber!: number;
}

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
