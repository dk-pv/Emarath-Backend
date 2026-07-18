import { Controller, Get, Query } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadListResponse } from './dto/lead-response.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /** GET /api/leads — one scoped page plus the total (LEAD-02.1). */
  @Get()
  list(@Query() query: ListLeadsQueryDto): Promise<LeadListResponse> {
    return this.leads.list(query);
  }
}
