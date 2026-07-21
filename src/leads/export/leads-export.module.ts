import { Module } from '@nestjs/common';
import { LeadsExportController } from './leads-export.controller';
import { LeadsExportService } from './leads-export.service';

/**
 * Lead export (LEAD-08.1). PrismaModule and AuthModule are global, so the service
 * reaches the DB and resolves the caller without importing either. Mirrors the
 * import module's shape, one folder per Leads capability.
 */
@Module({
  controllers: [LeadsExportController],
  providers: [LeadsExportService],
})
export class LeadsExportModule {}
