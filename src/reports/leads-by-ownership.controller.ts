import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadsByOwnershipReportService } from './leads-by-ownership.service';
import { LeadsByOwnershipQueryDto } from './dto/leads-by-ownership-query.dto';
import {
  LeadsByOwnershipFilterOptions,
  LeadsByOwnershipListResponse,
  LeadsByOwnershipSummaryResponse,
} from './dto/leads-by-ownership-response.dto';

/**
 * The Leads By Ownership report's HTTP surface (RPT-02.5). Thin by design: the DTO validates the
 * period/team filters, the service owns the scoped query. All routes are static paths under
 * `/api/reports/leads/by-ownership`, so none collides with the others.
 */
@Controller('reports/leads/by-ownership')
export class LeadsByOwnershipController {
  constructor(
    private readonly leadsByOwnership: LeadsByOwnershipReportService,
  ) {}

  /** GET /api/reports/leads/by-ownership — one scoped page of leads with owners (detailed). */
  @Get()
  list(
    @Query() query: LeadsByOwnershipQueryDto,
  ): Promise<LeadsByOwnershipListResponse> {
    return this.leadsByOwnership.listDetailed(query);
  }

  /** GET /api/reports/leads/by-ownership/summary — lead counts per owner (+ Unassigned). */
  @Get('summary')
  summary(
    @Query() query: LeadsByOwnershipQueryDto,
  ): Promise<LeadsByOwnershipSummaryResponse> {
    return this.leadsByOwnership.summary(query);
  }

  /** GET /api/reports/leads/by-ownership/filter-options — the team values the filter offers. */
  @Get('filter-options')
  filterOptions(): Promise<LeadsByOwnershipFilterOptions> {
    return this.leadsByOwnership.filterOptions();
  }

  /** GET /api/reports/leads/by-ownership/export — the same scoped set as a CSV download. */
  @Get('export')
  export(
    @Query() query: LeadsByOwnershipQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.leadsByOwnership.exportCsv(query, res);
  }
}
