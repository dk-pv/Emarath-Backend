import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditedExport } from '../audit/audited-export';
import { SalesPipelineQueryDto } from './dto/sales-pipeline-query.dto';
import { SalesPipelineResponse } from './dto/sales-pipeline-response.dto';
import { SalesPipelineReportService } from './sales-pipeline.service';

/**
 * Sales Pipeline Analysis' HTTP surface (ADR-0099). Like every other report, no `@Roles()`: the
 * sales roles reach it and the post-sale roles never do (RolesGuard), and the service scopes the
 * figures to the caller.
 */
@Controller('reports/sales-pipeline')
export class SalesPipelineController {
  constructor(private readonly salesPipeline: SalesPipelineReportService) {}

  /** GET /api/reports/sales-pipeline — the open pipeline, Won, this month's revenue and coverage. */
  @Get()
  report(
    @Query() query: SalesPipelineQueryDto,
  ): Promise<SalesPipelineResponse> {
    return this.salesPipeline.report(query);
  }

  /** GET /api/reports/sales-pipeline/export — the same report as a PDF download. */
  @Get('export')
  @AuditedExport('reports.sales-pipeline.export')
  export(
    @Query() query: SalesPipelineQueryDto,
    @Res() res: Response,
  ): Promise<number> {
    return this.salesPipeline.exportPdf(query, res);
  }
}
