import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ListLeadsQueryDto } from '../../leads/dto/list-leads-query.dto';
import {
  SALES_PIPELINE_VIEWS,
  type SalesPipelineView,
} from './sales-pipeline-response.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Sales Pipeline Analysis query: the Kanban board's own filters (pipeline, created window,
 * assigned agent, source — the Leads list DTO, as the Sales Funnel reads them), plus this month's
 * bounds as the client resolved them in its own timezone — the revenue, target and coverage are
 * "(This Month)" whatever window the toolbar holds.
 */
export class SalesPipelineQueryDto extends ListLeadsQueryDto {
  @IsDateString({}, { message: 'monthFrom must be an ISO date' })
  monthFrom!: string;

  @IsDateString({}, { message: 'monthTo must be an ISO date' })
  monthTo!: string;

  /** The view the export was taken from; the report itself returns both. */
  @IsOptional()
  @IsIn(SALES_PIPELINE_VIEWS, { message: 'view must be health or closing' })
  view?: SalesPipelineView;

  /** The export's header line, "Last 30 Days · All agents · Lead Pipeline". Display only. */
  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'subtitle must be a string' })
  @MaxLength(200, { message: 'subtitle must be at most 200 characters' })
  subtitle?: string;
}
