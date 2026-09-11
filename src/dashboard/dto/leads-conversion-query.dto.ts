import { IsIn, IsOptional } from 'class-validator';
import {
  LEADS_CONVERSION_BREAKDOWNS,
  type LeadsConversionBreakdown,
} from '../leads-conversion.service';
import { DashboardPeriodQueryDto } from './dashboard-period-query.dto';

/**
 * The Leads vs Conversion query (DASH-11.1).
 *
 * `breakdown` is the widget's Lead Source / Sales Team toggle, and it selects the
 * dimension the **aggregation** groups by — not a caption. The period is the shared
 * `from`/`to` window every Dashboard widget sends; both bounds absent is the All
 * preset, which applies no date predicate.
 */
export class LeadsConversionQueryDto extends DashboardPeriodQueryDto {
  @IsIn(LEADS_CONVERSION_BREAKDOWNS, {
    message: `breakdown must be one of: ${LEADS_CONVERSION_BREAKDOWNS.join(', ')}`,
  })
  @IsOptional()
  breakdown: LeadsConversionBreakdown = 'source';
}
