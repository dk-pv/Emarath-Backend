import { Module } from '@nestjs/common';
import { LeadTagsController } from './leads-tags.controller';
import { LeadTagsService } from './leads-tags.service';

/**
 * Per-lead tag mutations (LEAD-12.1). PrismaModule and AuthModule are global, so
 * DB access and the caller resolve without importing either — one folder per
 * Leads capability, mirroring bulk/import/export/row-actions.
 */
@Module({
  controllers: [LeadTagsController],
  providers: [LeadTagsService],
})
export class LeadsTagsModule {}
