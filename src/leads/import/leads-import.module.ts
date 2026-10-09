import { Module } from '@nestjs/common';
import { ImportModule } from '../../common/import/import.module';
import { LookupsModule } from '../../lookups/lookups.module';
import { SettingsModule } from '../../settings/settings.module';
import { StagesModule } from '../../stages/stages.module';
import { LeadsImportController } from './leads-import.controller';
import { LeadsImportService } from './leads-import.service';
import { LeadsImportDescriptor } from './leads-import.descriptor';
import { LeadsImportRepository } from './leads-import.repository';
import { ImportJobRepository } from './import-job.repository';

/**
 * Leads bulk import (LEAD-07.1). Composes the reusable engine (`ImportModule`) with
 * the Leads descriptor and the import-job persistence. Auth (`CurrentUserService`)
 * and Prisma come from their global modules; lookups, stages and Duplicate Settings
 * supply the values a row is checked against (ADR-0088).
 */
@Module({
  imports: [ImportModule, LookupsModule, StagesModule, SettingsModule],
  controllers: [LeadsImportController],
  providers: [
    LeadsImportService,
    LeadsImportDescriptor,
    LeadsImportRepository,
    ImportJobRepository,
  ],
})
export class LeadsImportModule {}
