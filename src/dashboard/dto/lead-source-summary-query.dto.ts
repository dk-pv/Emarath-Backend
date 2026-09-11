import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import {
  LEAD_SOURCE_DATE_MODES,
  type LeadSourceDateMode,
} from '../lead-source-summary.service';
import { DashboardPeriodQueryDto } from './dashboard-period-query.dto';

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The Lead Source Summary query (DASH-10.1).
 *
 * `mode` is the widget's Created Date / Assigned Date toggle, and it selects the
 * date **column the aggregation runs on** — not a label. `todayStart` is the
 * caller's own local midnight (ADR-0028 §3) and is required even though `from` is
 * not: it is the day boundary the columns are measured from when the period is All
 * and carries no bounds of its own.
 */
export class LeadSourceSummaryQueryDto extends DashboardPeriodQueryDto {
  @IsIn(LEAD_SOURCE_DATE_MODES, {
    message: `mode must be one of: ${LEAD_SOURCE_DATE_MODES.join(', ')}`,
  })
  @IsOptional()
  mode: LeadSourceDateMode = 'created';

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'todayStart must be a valid date' })
  todayStart!: string;
}
