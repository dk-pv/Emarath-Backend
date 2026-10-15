import { Module } from '@nestjs/common';
import { LeadCustomFieldsModule } from '../../lead-custom-fields/lead-custom-fields.module';
import { LeadsExportController } from './leads-export.controller';
import { LeadsExportService } from './leads-export.service';

/**
 * Lead export (LEAD-08.1). PrismaModule and AuthModule are global, so the service
 * reaches the DB and resolves the caller without importing either. Mirrors the
 * import module's shape, one folder per Leads capability. The custom-field module
 * supplies the custom columns an export can name (the same set the table shows).
 */
@Module({
  imports: [LeadCustomFieldsModule],
  controllers: [LeadsExportController],
  providers: [LeadsExportService],
})
export class LeadsExportModule {}
