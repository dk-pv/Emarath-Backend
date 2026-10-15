import { Module } from '@nestjs/common';
import { TagAccessModule } from '../../tag-access/tag-access.module';
import { LeadTagsController } from './leads-tags.controller';
import { LeadTagsService } from './leads-tags.service';

/**
 * Per-lead tag mutations (LEAD-12.1). PrismaModule and AuthModule are global, so
 * DB access and the caller resolve without importing either — one folder per
 * Leads capability, mirroring bulk/import/export/row-actions. Tag Permissions
 * (ADR-0091) gate which tags a caller may add or remove.
 */
@Module({
  imports: [TagAccessModule],
  controllers: [LeadTagsController],
  providers: [LeadTagsService],
})
export class LeadsTagsModule {}
