import { Module } from '@nestjs/common';
import { LeadCustomFieldsController } from './lead-custom-fields.controller';
import { LeadCustomFieldsService } from './lead-custom-fields.service';

/**
 * LEAD-05.1 custom columns (ADR-0051). Exports the service so LeadsModule can validate
 * and persist per-lead custom values through the same create/update flow.
 */
@Module({
  controllers: [LeadCustomFieldsController],
  providers: [LeadCustomFieldsService],
  exports: [LeadCustomFieldsService],
})
export class LeadCustomFieldsModule {}
