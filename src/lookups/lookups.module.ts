import { Module } from '@nestjs/common';
import { LookupsController } from './lookups.controller';
import { LookupsService } from './lookups.service';

/** Lookup providers for form dropdowns (ADR-0005). PrismaService is global. */
@Module({
  controllers: [LookupsController],
  providers: [LookupsService],
})
export class LookupsModule {}
