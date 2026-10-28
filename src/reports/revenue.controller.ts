import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditedExport } from '../audit/audited-export';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import type {
  RevenueDealsResponse,
  RevenueOverviewResponse,
} from './dto/revenue-response.dto';
import { RevenueReportService } from './revenue.service';

/**
 * The Revenue Report's HTTP surface (ADR-0099 decision 15). Like every other report, no
 * `@Roles()`: the sales roles reach it, the post-sale roles never do (RolesGuard), and the service
 * scopes every figure and row to the caller.
 */
@Controller('reports/revenue')
export class RevenueController {
  constructor(private readonly revenue: RevenueReportService) {}

  /** GET /api/reports/revenue — KPIs, target, trend, and revenue by source and by pipeline. */
  @Get()
  overview(@Query() query: RevenueQueryDto): Promise<RevenueOverviewResponse> {
    return this.revenue.overview(query);
  }

  /** GET /api/reports/revenue/deals — one sorted, grouped page of the Data Grid. */
  @Get('deals')
  deals(@Query() query: RevenueQueryDto): Promise<RevenueDealsResponse> {
    return this.revenue.deals(query);
  }

  /** GET /api/reports/revenue/export — the report and its deals as a PDF download. */
  @Get('export')
  @AuditedExport('reports.revenue.export')
  export(
    @Query() query: RevenueQueryDto,
    @Res() res: Response,
  ): Promise<number> {
    return this.revenue.exportPdf(query, res);
  }
}
