import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { LogisticsOrdersService } from './logistics-orders.service';
import { ACTION_ROLES, LOGISTICS_READ_ROLES } from './logistics-roles';
import {
  CorrectAwbDto,
  DispatchOrderDto,
  ListLogisticsOrdersDto,
  LogisticsDeliveryScheduleResponse,
  LogisticsOrderFilterOptions,
  LogisticsOrderFiltersDto,
  LogisticsOrderListResponse,
  LogisticsOrderResponse,
  LogisticsOrderSummaryResponse,
  OrderReasonDto,
  QcDecisionDto,
  QcRejectDto,
  SetDeliveryDateDto,
  UpdateLogisticsOrderDto,
} from './dto/logistics-order.dto';

/**
 * The Logistics order API (ADR-0085), with the permissions of the client clarification of
 * 2026-10-01 (`logistics-roles.ts`). They are enforced here rather than in the UI: QC verifies
 * and rejects; both Logistics roles dispatch, deliver and cancel; the Logistics Manager also
 * records RTO, edits a QC-verified order and corrects an AWB after dispatch; the Sales Manager
 * resubmits a rejected order; the sales agent and the Sales Manager set the delivery date until
 * QC verifies the order (Phase 2D); Customer Service and Marketing only read. `@Roles()` is what
 * admits an operational role to a route in the first place (ADR-0084), so a route that forgets
 * it is closed, not open.
 *
 * Every order returned also carries `allowedActions`, computed from the same `ACTION_ROLES`
 * these routes read — advisory for the UI only. These routes, the caller's scope and the
 * transition table remain the authority; a caller that ignores the list is refused exactly as
 * before.
 */
@Controller('logistics/orders')
export class LogisticsOrdersController {
  constructor(private readonly orders: LogisticsOrdersService) {}

  @Get()
  @Roles(...LOGISTICS_READ_ROLES)
  list(
    @Query() query: ListLogisticsOrdersDto,
  ): Promise<LogisticsOrderListResponse> {
    return this.orders.list(query);
  }

  /**
   * The queue's counts per status, country and city. Declared before `:id`, which would
   * otherwise take it.
   */
  @Get('summary')
  @Roles(...LOGISTICS_READ_ROLES)
  summary(
    @Query() query: LogisticsOrderFiltersDto,
  ): Promise<LogisticsOrderSummaryResponse> {
    return this.orders.summary(query);
  }

  /**
   * The delivery schedule: counts per delivery bucket and per day for the coming two weeks, under
   * every filter but the delivery date's own. Before `:id`.
   */
  @Get('delivery-schedule')
  @Roles(...LOGISTICS_READ_ROLES)
  deliverySchedule(
    @Query() query: LogisticsOrderFiltersDto,
  ): Promise<LogisticsDeliveryScheduleResponse> {
    return this.orders.deliverySchedule(query);
  }

  /** The country and city values the filter offers — the caller's scope only. Before `:id`. */
  @Get('filter-options')
  @Roles(...LOGISTICS_READ_ROLES)
  filterOptions(): Promise<LogisticsOrderFilterOptions> {
    return this.orders.filterOptions();
  }

  @Get(':id')
  @Roles(...LOGISTICS_READ_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<LogisticsOrderResponse> {
    return this.orders.get(id);
  }

  @Post(':id/qc-verify')
  @Roles(...ACTION_ROLES.QC_VERIFY)
  qcVerify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QcDecisionDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.qcVerify(id, dto);
  }

  @Post(':id/qc-reject')
  @Roles(...ACTION_ROLES.QC_REJECT)
  qcReject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QcRejectDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.qcReject(id, dto);
  }

  @Post(':id/resubmit')
  @Roles(...ACTION_ROLES.RESUBMIT)
  resubmit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QcDecisionDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.resubmit(id, dto);
  }

  @Post(':id/dispatch')
  @Roles(...ACTION_ROLES.DISPATCH)
  dispatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispatchOrderDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.dispatch(id, dto);
  }

  @Post(':id/deliver')
  @Roles(...ACTION_ROLES.DELIVER)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.deliver(id);
  }

  @Post(':id/cancel')
  @Roles(...ACTION_ROLES.CANCEL)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.cancel(id, dto);
  }

  @Post(':id/rto')
  @Roles(...ACTION_ROLES.RTO)
  rto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.rto(id, dto);
  }

  /** The Logistics Manager's correction of a QC-verified order's data (Q5). */
  @Patch(':id')
  @Roles(...ACTION_ROLES.EDIT)
  edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogisticsOrderDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.edit(id, dto);
  }

  /** The Logistics Manager's correction of the AWB after dispatch (Q9). */
  @Patch(':id/awb')
  @Roles(...ACTION_ROLES.CORRECT_AWB)
  correctAwb(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectAwbDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.correctAwb(id, dto);
  }

  /** Sales sets or clears the requested delivery date before QC verifies the order (Phase 2D). */
  @Patch(':id/delivery-date')
  @Roles(...ACTION_ROLES.SET_DELIVERY_DATE)
  setDeliveryDate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDeliveryDateDto,
  ): Promise<LogisticsOrderResponse> {
    return this.orders.setDeliveryDate(id, dto);
  }
}
