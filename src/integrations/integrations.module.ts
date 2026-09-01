import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * The integration library registry (INT-01.1). PrismaModule is global, so DB access
 * resolves without importing it. Nothing is exported: no other module reads the
 * registry yet, and the capture/provider tasks that eventually will (INT-03.x, INT-04.x)
 * are not built.
 */
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
