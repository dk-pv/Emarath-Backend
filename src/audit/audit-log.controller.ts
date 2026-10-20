import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { AuditLogService } from './audit-log.service';
import {
  AuditLogFilterOptions,
  AuditLogListResponse,
  ListAuditLogDto,
} from './dto/audit-log.dto';

/**
 * Settings → Users & Access → Audit Log (AUD-02). Super Admin only, on every route, enforced by
 * the role guard before the service runs. Two reads and nothing else: there is no route that
 * creates, edits or deletes an event.
 */
@Controller('audit/log')
@Roles(UserRole.SUPERADMIN)
export class AuditLogController {
  constructor(private readonly log: AuditLogService) {}

  @Get()
  list(@Query() query: ListAuditLogDto): Promise<AuditLogListResponse> {
    return this.log.list(query);
  }

  @Get('filter-options')
  filterOptions(): Promise<AuditLogFilterOptions> {
    return this.log.filterOptions();
  }
}
