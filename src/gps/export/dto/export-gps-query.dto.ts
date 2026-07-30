import { IsIn } from 'class-validator';
import { GpsSummaryFilterDto } from '../../dto/gps-summary-filter.dto';

/**
 * The GPS export query (GPS-08.1). Extends the summary filter so the period
 * (`dateFrom`/`dateTo`) and Team Member (`userId`) validate and scope identically
 * to the KPIs/map/list — the file must match the on-screen view (AC2/AC4) — while
 * adding the output format. CSV and Excel only, mirroring the leads export.
 */
export class ExportGpsQueryDto extends GpsSummaryFilterDto {
  @IsIn(['csv', 'xlsx'], { message: 'format must be csv or xlsx' })
  format!: 'csv' | 'xlsx';
}
