import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditedExport } from '../audit/audited-export';
import { SalesFunnelQueryDto } from './dto/sales-funnel-query.dto';
import { SalesFunnelResponse } from './dto/sales-funnel-response.dto';
import { SalesFunnelReportService } from './sales-funnel.service';

/**
 * The Analytics Sales Funnel Report's HTTP surface (ADR-0099). Thin: the DTO validates the
 * board's filters plus the view, the service scopes and computes. Both routes are static paths
 * under `/api/reports/sales-funnel`.
 */
@Controller('reports/sales-funnel')
export class SalesFunnelController {
  constructor(private readonly salesFunnel: SalesFunnelReportService) {}

  /** GET /api/reports/sales-funnel — the funnel, Stage Metrics and KPIs for one view. */
  @Get()
  report(@Query() query: SalesFunnelQueryDto): Promise<SalesFunnelResponse> {
    return this.salesFunnel.report(query);
  }

  /** GET /api/reports/sales-funnel/export — the same report as a PDF download. */
  @Get('export')
  @AuditedExport('reports.sales-funnel.export')
  export(
    @Query() query: SalesFunnelQueryDto,
    @Res() res: Response,
  ): Promise<number> {
    return this.salesFunnel.exportPdf(query, res);
  }
}
