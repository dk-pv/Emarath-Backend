import { Module } from '@nestjs/common';
import { LeadsBulkController } from './leads-bulk.controller';
import { LeadsBulkService } from './leads-bulk.service';

/**
 * Bulk lead actions (LEAD-09.1). PrismaModule and AuthModule are global, so the
 * service reaches the DB and resolves the caller without importing either — one
 * folder per Leads capability, mirroring import and export.
 */
@Module({
  controllers: [LeadsBulkController],
  providers: [LeadsBulkService],
})
export class LeadsBulkModule {}
