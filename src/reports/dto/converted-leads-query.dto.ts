import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizeFilterValues } from '../../leads/lead-filter';
import {
  DEFAULT_REPORT_PAGE_SIZE,
  MAX_FILTER_VALUES,
  MAX_REPORT_PAGE_SIZE,
  MAX_SOURCE_LENGTH,
} from './no-activity-query.dto';

/** `Lead.pipeline` is `VarChar(120)`; a longer value can never match a row. */
const MAX_VALUE_LENGTH = 120;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Converted Leads report query (RPT-02.6): paging plus the period/agent/source filters
 * (AC3). `agent`/`source` accept repeated params (`?source=A&source=B`), coerced to a clean
 * array (or dropped when blank) by the shared `normalizeFilterValues`. `from`/`to` are ISO
 * instants the client computes in its own timezone (the createdAt period; `from` is the selected
 * preset). Validated before the service runs, so an invalid request is a clean 400 with nothing
 * queried.
 */
export class ConvertedLeadsQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be 1 or greater' })
  @IsOptional()
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'size must be an integer' })
  @Min(1, { message: 'size must be 1 or greater' })
  @Max(MAX_REPORT_PAGE_SIZE, {
    message: `size must be at most ${MAX_REPORT_PAGE_SIZE}`,
  })
  @IsOptional()
  size: number = DEFAULT_REPORT_PAGE_SIZE;

  @Transform(trim)
  @IsDateString({}, { message: 'from must be an ISO date' })
  @IsOptional()
  from?: string;

  @Transform(trim)
  @IsDateString({}, { message: 'to must be an ISO date' })
  @IsOptional()
  to?: string;

  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'source must be one or more values' })
  @IsString({ each: true, message: 'each source must be a string' })
  @MaxLength(MAX_SOURCE_LENGTH, {
    each: true,
    message: `each source must be at most ${MAX_SOURCE_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `source accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  source?: string[];

  @Transform(({ value }: { value: unknown }): unknown =>
    normalizeFilterValues(value),
  )
  @IsArray({ message: 'agent must be one or more values' })
  @IsUUID('all', { each: true, message: 'each agent must be a valid id' })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `agent accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  agent?: string[];

  /** Which lead date the `from`/`to` window applies to: creation (default) or the last status change — for a WON lead, when it converted. */
  @Transform(trim)
  @IsIn(['created', 'statusChanged'], {
    message: 'dateField must be created or statusChanged',
  })
  @IsOptional()
  dateField?: 'created' | 'statusChanged';

  /** The board a lead belongs to (toolbar "Pipeline") — one exact value. */
  @Transform(trim)
  @IsString({ message: 'pipeline must be a string' })
  @MaxLength(MAX_VALUE_LENGTH, {
    message: `pipeline must be at most ${MAX_VALUE_LENGTH} characters`,
  })
  @IsOptional()
  pipeline?: string;

  /**
   * The Filter condition builder's JSON payload (ADR-0039) — the same param the Leads
   * list accepts, parsed and whitelisted by `parseLeadConditions` inside `buildLeadWhere`.
   */
  @IsString({ message: 'conditions must be a JSON string' })
  @MaxLength(8000, { message: 'conditions payload is too large' })
  @IsOptional()
  conditions?: string;
}
