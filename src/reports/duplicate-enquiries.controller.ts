import { Controller, Get, Query } from '@nestjs/common';
import { DuplicateEnquiriesQueryDto } from './dto/duplicate-enquiries-query.dto';
import {
  DuplicateEnquiriesListResponse,
  DuplicateEnquiriesSummaryResponse,
} from './dto/duplicate-enquiries-response.dto';
import { DuplicateEnquiriesService } from './duplicate-enquiries.service';

/**
 * The Duplicate Enquiries report's read API (RPT-02.10). Both routes are role-scoped by
 * the service through the shared `buildLeadWhere`, so a caller only ever sees leads their
 * scope already permits.
 */
@Controller('reports/leads/duplicate-enquiries')
export class DuplicateEnquiriesController {
  constructor(private readonly duplicates: DuplicateEnquiriesService) {}

  /** GET /api/reports/leads/duplicate-enquiries — one page of duplicate groups. */
  @Get()
  list(
    @Query() query: DuplicateEnquiriesQueryDto,
  ): Promise<DuplicateEnquiriesListResponse> {
    return this.duplicates.list(query);
  }

  /** GET /api/reports/leads/duplicate-enquiries/summary — the five threshold cards. */
  @Get('summary')
  summary(
    @Query() query: DuplicateEnquiriesQueryDto,
  ): Promise<DuplicateEnquiriesSummaryResponse> {
    return this.duplicates.summary(query);
  }
}
