import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { LOGISTICS_READ_ROLES } from '../logistics/logistics-roles';
import { AuditEventsService } from './audit-events.service';
import {
  AuditEventListResponse,
  ListAuditEventsDto,
} from './dto/audit-event.dto';

/**
 * The customer journey, read (ADR-0083 §11 of the client specification: status changes,
 * pipeline movements, QC decisions and remarks, dispatch and delivery updates, all traceable).
 *
 * One route, one verb. The log is append-only, so there is nothing to POST, PATCH or DELETE
 * here — events are written by the change that caused them and never afterwards.
 *
 * `LOGISTICS_READ_ROLES` is the reader set an order already uses: every sales role (their own
 * leads only, enforced in the service) plus both Logistics roles and QC. Accounts is not named, so
 * ADR-0084's deny-by-default keeps it out until its own phase gives it a scope.
 */
@Controller('audit/events')
export class AuditEventsController {
  constructor(private readonly events: AuditEventsService) {}

  @Get()
  @Roles(...LOGISTICS_READ_ROLES)
  list(@Query() query: ListAuditEventsDto): Promise<AuditEventListResponse> {
    return this.events.list(query);
  }
}
