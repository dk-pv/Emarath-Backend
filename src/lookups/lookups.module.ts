import { Module } from '@nestjs/common';
import { LookupsController } from './lookups.controller';
import { LookupsService } from './lookups.service';

/**
 * Lookup providers for form dropdowns (ADR-0005). PrismaService is global. Exported so
 * the Leads import checks values against the same lists the form offers (ADR-0088).
 */
@Module({
  controllers: [LookupsController],
  providers: [LookupsService],
  exports: [LookupsService],
})
export class LookupsModule {}
