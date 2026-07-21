import { Module } from '@nestjs/common';
import { ImportModule } from '../../common/import/import.module';
import { LeadsImportController } from './leads-import.controller';
import { LeadsImportService } from './leads-import.service';
import { LeadsImportDescriptor } from './leads-import.descriptor';
import { LeadsImportRepository } from './leads-import.repository';
import { ImportJobRepository } from './import-job.repository';

/**
 * Leads bulk import (LEAD-07.1). Composes the reusable engine (`ImportModule`) with
 * the Leads descriptor and the import-job persistence. Auth (`CurrentUserService`)
 * and Prisma come from their global modules.
 */
@Module({
  imports: [ImportModule],
  controllers: [LeadsImportController],
  providers: [
    LeadsImportService,
    LeadsImportDescriptor,
    LeadsImportRepository,
    ImportJobRepository,
  ],
})
export class LeadsImportModule {}
