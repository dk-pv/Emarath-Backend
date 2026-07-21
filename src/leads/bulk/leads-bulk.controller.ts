import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { LeadsBulkService } from './leads-bulk.service';
import {
  BulkActionResponse,
  BulkDeleteDto,
  BulkReassignDto,
} from './dto/bulk-actions.dto';

/**
 * Bulk actions over selected leads (LEAD-09.1), under `/api/leads/bulk`.
 *
 * POST, not DELETE, for the delete action: it carries a body (the id set) and
 * returns a per-item result, which a DELETE body is not meant to do. Both return
 * 200 — they act on existing leads, they do not create a resource.
 */
@Controller('leads/bulk')
export class LeadsBulkController {
  constructor(private readonly service: LeadsBulkService) {}

  /** POST /api/leads/bulk/reassign — reassign the selected leads to one agent. */
  @Post('reassign')
  @HttpCode(200)
  reassign(@Body() dto: BulkReassignDto): Promise<BulkActionResponse> {
    return this.service.reassign(dto);
  }

  /** POST /api/leads/bulk/delete — permanently delete the selected leads. */
  @Post('delete')
  @HttpCode(200)
  delete(@Body() dto: BulkDeleteDto): Promise<BulkActionResponse> {
    return this.service.delete(dto);
  }
}
