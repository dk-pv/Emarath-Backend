import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ListLeadsQueryDto } from '../../leads/dto/list-leads-query.dto';
import { toOptionalBoolean } from './no-activity-query.dto';
import {
  SALES_FUNNEL_VIEWS,
  type SalesFunnelView,
} from './sales-funnel-response.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The Sales Funnel Report query. Its filters are the Kanban board's own — pipeline, created
 * window, assigned agent, source — parsed by the Leads list DTO, so the report can never narrow
 * its leads differently from the board or the list (the BoardQueryDto rule). On top: which view,
 * and the "Include Lost Stage" switch, which Workpex opens ticked.
 */
export class SalesFunnelQueryDto extends ListLeadsQueryDto {
  @IsOptional()
  @IsIn(SALES_FUNNEL_VIEWS, { message: 'view must be full or live' })
  view?: SalesFunnelView;

  @Transform(toOptionalBoolean)
  @IsBoolean({ message: 'includeLost must be a boolean' })
  @IsOptional()
  includeLost?: boolean;

  /** The export's header line, "Last 30 Days · All agents · Lead Pipeline". Display only. */
  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'subtitle must be a string' })
  @MaxLength(200, { message: 'subtitle must be at most 200 characters' })
  subtitle?: string;
}
