import { Controller, Get, Param } from '@nestjs/common';
import { LookupsService } from './lookups.service';
import { LookupOption } from './lookups.data';

/** GET /api/lookups/:type — dropdown options for the New Lead form (ADR-0005). */
@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get(':type')
  byType(@Param('type') type: string): Promise<LookupOption[]> {
    return this.lookups.byType(type);
  }
}
