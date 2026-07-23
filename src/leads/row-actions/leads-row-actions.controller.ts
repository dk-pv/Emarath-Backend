import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { LeadRowActionsService } from './leads-row-actions.service';
import { LeadListItem } from '../dto/lead-response.dto';
import {
  ReassignLeadDto,
  RowDeleteResponse,
  SetLeadStatusDto,
} from './dto/row-actions.dto';

/**
 * Per-lead row quick actions (LEAD-10.1), under `/api/leads/:id/…`.
 *
 * A separate controller from the collection routes so `leads.controller` stays a
 * pure read/create surface; the `:id` param is UUID-guarded at the edge, so a
 * malformed id is a 400 before any query runs. Duplicate is a POST that creates a
 * resource (201); reassign, status and delete act on an existing lead (200).
 * There are deliberately no WhatsApp/email routes — those are client deep-links
 * (LEAD-10.2), not a server action.
 */
@Controller('leads')
export class LeadRowActionsController {
  constructor(private readonly service: LeadRowActionsService) {}

  /** POST /api/leads/:id/duplicate — copy a lead into a new record (AC2). */
  @Post(':id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string): Promise<LeadListItem> {
    return this.service.duplicate(id);
  }

  /** POST /api/leads/:id/reassign — reassign this lead to one agent (AC3). */
  @Post(':id/reassign')
  @HttpCode(200)
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignLeadDto,
  ): Promise<LeadListItem> {
    return this.service.reassign(id, dto);
  }

  /** POST /api/leads/:id/status — set this lead's status value (AC4). */
  @Post(':id/status')
  @HttpCode(200)
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetLeadStatusDto,
  ): Promise<LeadListItem> {
    return this.service.setStatus(id, dto);
  }

  /** DELETE /api/leads/:id — permanently remove this lead (AC5). */
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<RowDeleteResponse> {
    return this.service.delete(id);
  }
}
