import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { AccountsRecordsService } from './accounts-records.service';
import {
  ACCOUNTS_CORRECTION_ROLES,
  ACCOUNTS_MOVE_ROLES,
  ACCOUNTS_READ_ROLES,
} from './accounts-roles';
import {
  AccountsRecordFilterOptions,
  AccountsRecordFiltersDto,
  AccountsRecordListResponse,
  AccountsRecordResponse,
  AccountsRecordSummaryResponse,
  CorrectPaymentStatusDto,
  ListAccountsRecordsDto,
  MovePaymentStatusDto,
} from './dto/accounts-record.dto';

/**
 * The Accounts API (ADR-0096). Permissions are enforced here, not in the UI (`accounts-roles.ts`):
 * the Accounts Executive reads records and moves their payment status; corrections are the Super
 * Admin's alone until the client names the Accounts head. `@Roles()` is what admits an operational
 * role to a route in the first place (ADR-0084), so a route that forgets it is closed, not open.
 *
 * There is no create: a record is opened by the delivery that makes an order DELIVERED, in that
 * move's own transaction. Nothing deletes one.
 */
@Controller('accounts/records')
export class AccountsRecordsController {
  constructor(private readonly records: AccountsRecordsService) {}

  @Get()
  @Roles(...ACCOUNTS_READ_ROLES)
  list(
    @Query() query: ListAccountsRecordsDto,
  ): Promise<AccountsRecordListResponse> {
    return this.records.list(query);
  }

  /** The count per payment status. Declared before `:id`, which would otherwise take it. */
  @Get('summary')
  @Roles(...ACCOUNTS_READ_ROLES)
  summary(
    @Query() query: AccountsRecordFiltersDto,
  ): Promise<AccountsRecordSummaryResponse> {
    return this.records.summary(query);
  }

  /** The payment method and courier values the filter offers. Before `:id`. */
  @Get('filter-options')
  @Roles(...ACCOUNTS_READ_ROLES)
  filterOptions(): Promise<AccountsRecordFilterOptions> {
    return this.records.filterOptions();
  }

  @Get(':id')
  @Roles(...ACCOUNTS_READ_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AccountsRecordResponse> {
    return this.records.get(id);
  }

  @Post(':id/status')
  @Roles(...ACCOUNTS_MOVE_ROLES)
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MovePaymentStatusDto,
  ): Promise<AccountsRecordResponse> {
    return this.records.move(id, dto);
  }

  @Post(':id/correction')
  @Roles(...ACCOUNTS_CORRECTION_ROLES)
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectPaymentStatusDto,
  ): Promise<AccountsRecordResponse> {
    return this.records.correct(id, dto);
  }
}
