import { Module } from '@nestjs/common';
import { LeadsBulkModule } from '../bulk/leads-bulk.module';
import { LeadRowActionsController } from './leads-row-actions.controller';
import { LeadRowActionsService } from './leads-row-actions.service';

/**
 * Row quick actions (LEAD-10.1). Imports LeadsBulkModule to reuse the scoped,
 * transactional reassign/delete instead of re-implementing them; PrismaModule and
 * AuthModule are global, so DB access and the caller resolve without importing
 * either — one folder per Leads capability, mirroring bulk/import/export.
 */
@Module({
  imports: [LeadsBulkModule],
  controllers: [LeadRowActionsController],
  providers: [LeadRowActionsService],
})
export class LeadsRowActionsModule {}
