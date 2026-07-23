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
  // Exported so the single-lead row actions (LEAD-10.1) reuse the scoped reassign
  // and hard-delete instead of writing that query logic a second time.
  exports: [LeadsBulkService],
})
export class LeadsBulkModule {}
