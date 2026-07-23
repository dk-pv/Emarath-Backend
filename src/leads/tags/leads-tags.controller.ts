import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { LeadTagsService } from './leads-tags.service';
import { LeadListItem } from '../dto/lead-response.dto';
import { AddLeadTagDto } from './dto/lead-tag.dto';

/**
 * Per-lead tag routes (LEAD-12.1), under `/api/leads/:id/tags`.
 *
 * A separate controller from the collection routes, mirroring row-actions, so
 * `leads.controller` stays a pure read/create surface. Both ids are UUID-guarded
 * at the edge, so a malformed id is a 400 before any query runs. Each returns the
 * updated lead so the row can refresh its tag chips without a full reload (AC3).
 */
@Controller('leads')
export class LeadTagsController {
  constructor(private readonly service: LeadTagsService) {}

  /** POST /api/leads/:id/tags — apply an existing tag to this lead (AC1). */
  @Post(':id/tags')
  @HttpCode(200)
  add(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddLeadTagDto,
  ): Promise<LeadListItem> {
    return this.service.add(id, dto);
  }

  /** DELETE /api/leads/:id/tags/:tagId — remove one tag from this lead (AC2). */
  @Delete(':id/tags/:tagId')
  @HttpCode(200)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ): Promise<LeadListItem> {
    return this.service.remove(id, tagId);
  }
}
