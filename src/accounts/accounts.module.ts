import { Module } from '@nestjs/common';
import { AccountsRecordsController } from './accounts-records.controller';
import { AccountsRecordsService } from './accounts-records.service';

/**
 * Phase 5 of the client CRM workflow, Accounts v1 (ADR-0096): the payment record each delivered
 * order gets, and its status. PrismaModule and AuthModule are global, so database access and the
 * caller resolve without importing either.
 *
 * Record creation is not here: it happens inside the Logistics delivery, through
 * `accounts-record.ts`, so an order's move to DELIVERED and its record share one transaction.
 */
@Module({
  controllers: [AccountsRecordsController],
  providers: [AccountsRecordsService],
})
export class AccountsModule {}
