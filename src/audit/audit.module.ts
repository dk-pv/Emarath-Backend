import { Module } from '@nestjs/common';
import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/**
 * Reading the audit log (ADR-0083). Writing it is not here and never will be: every event is
 * recorded through `audit-events.ts` by the transaction that made the change, so the module
 * owns the read side alone. PrismaModule and AuthModule are global.
 */
@Module({
  controllers: [AuditEventsController, AuditLogController],
  providers: [AuditEventsService, AuditLogService],
})
export class AuditModule {}
