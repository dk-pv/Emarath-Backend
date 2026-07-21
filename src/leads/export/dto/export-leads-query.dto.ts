import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ListLeadsQueryDto } from '../../dto/list-leads-query.dto';

/**
 * The export query (LEAD-08.1). Extends the list query so search, the field/quick
 * filters, sort and direction validate and behave identically — the file must match
 * the on-screen view (AC1) — while adding the format, the field scope, and the
 * client's visible-column list. `page`/`size` are inherited but unused: an export
 * is the whole matching set, not a page.
 */
export class ExportLeadsQueryDto extends ListLeadsQueryDto {
  /** CSV and Excel only; PDF is deferred (no library, no layout reference yet). */
  @IsIn(['csv', 'xlsx'], { message: 'format must be csv or xlsx' })
  format!: 'csv' | 'xlsx';

  /** `default` = the visible columns (below); `all` = every field. */
  @IsIn(['default', 'all'], { message: 'scope must be default or all' })
  scope!: 'default' | 'all';

  /**
   * The visible column ids in order, comma-separated (scope=default). The client
   * sends what it shows; unknown ids are dropped server-side. Ignored for scope=all.
   */
  @IsString()
  @MaxLength(4000)
  @Matches(/^[A-Za-z0-9,]*$/, {
    message: 'columns must be a comma-separated list of column ids',
  })
  @IsOptional()
  columns?: string;
}
