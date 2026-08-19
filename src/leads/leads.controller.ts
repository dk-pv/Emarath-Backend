import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadListItem, LeadListResponse } from './dto/lead-response.dto';
import { LeadFilterOptions } from './dto/lead-filter-options.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /**
   * GET /api/leads/filter-options — the scoped Source/Status/Assigned Agent
   * values the filter panel offers (LEAD-03.3). Declared before any future
   * `:id` route so the static segment is never captured as an id.
   */
  @Get('filter-options')
  filterOptions(): Promise<LeadFilterOptions> {
    return this.leads.filterOptions();
  }

  /** GET /api/leads/assignable-agents — the Assigned field's options (LEAD-06.2). */
  @Get('assignable-agents')
  assignableAgents(): Promise<{ id: string; name: string }[]> {
    return this.leads.assignableAgents();
  }

  /** GET /api/leads — one scoped page plus the total (LEAD-02.1). */
  @Get()
  list(@Query() query: ListLeadsQueryDto): Promise<LeadListResponse> {
    return this.leads.list(query);
  }

  /** POST /api/leads — create a lead from the New Lead form (LEAD-06.1). */
  @Post()
  create(@Body() dto: CreateLeadDto): Promise<LeadListItem> {
    return this.leads.create(dto);
  }

  /**
   * POST /api/leads/:id/pin — pin a lead for the current caller (ADR-0031). A
   * sub-resource, so the static routes above are never captured as an id. The
   * caller is resolved server-side; the body carries no user. Returns the lead
   * in its pinned state.
   */
  @Post(':id/pin')
  pin(@Param('id', ParseUUIDPipe) id: string): Promise<LeadListItem> {
    return this.leads.setPinned(id, true);
  }

  /** DELETE /api/leads/:id/pin — unpin a lead for the current caller (ADR-0031). */
  @Delete(':id/pin')
  unpin(@Param('id', ParseUUIDPipe) id: string): Promise<LeadListItem> {
    return this.leads.setPinned(id, false);
  }

  /**
   * GET /api/leads/:id — one scoped lead for the Lead Detail page. Declared last
   * so the static `:id`-shaped routes above are never captured as an id.
   */
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<LeadListItem> {
    return this.leads.findById(id);
  }
}
