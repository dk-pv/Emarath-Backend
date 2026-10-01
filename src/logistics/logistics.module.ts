import { Module } from '@nestjs/common';
import { LogisticsOrdersController } from './logistics-orders.controller';
import { LogisticsOrdersService } from './logistics-orders.service';

/**
 * Phase 3 of the client CRM workflow: the order a won lead becomes, and its lifecycle
 * (ADR-0085). PrismaModule and AuthModule are global, so database access and the caller
 * resolve without importing either.
 *
 * Conversion itself is not here: it happens inside the lead write paths, through
 * `logistics-conversion.ts`, so an order and the status change that caused it share one
 * transaction. This module owns only what happens to an order afterwards.
 */
@Module({
  controllers: [LogisticsOrdersController],
  providers: [LogisticsOrdersService],
})
export class LogisticsModule {}
