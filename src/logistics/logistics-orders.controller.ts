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
import { LogisticsOrdersService } from './logistics-orders.service';
import { ACTION_ROLES, LOGISTICS_READ_ROLES } from './logistics-roles';
import {
  DispatchOrderDto,
  ListLogisticsOrdersDto,
  LogisticsOrderListResponse,
  LogisticsOrderResponse,
  OrderReasonDto,
  QcDecisionDto,
} from './dto/logistics-order.dto';

/**
 * The Logistics order API (ADR-0085).
 *
 * Permissions are enforced here rather than in the UI. The Logistics Manager dispatches,
 * delivers, cancels and records RTO (client-confirmed); Sales read their own converted leads'
 * orders and hold no mutation at all. The QC routes and the resubmit route are gated by
 * provisional mappings the client has not confirmed (QC → Logistics Executive, resubmit →
 * Logistics Manager), so all three are **withheld**: `allowedActions` never offers them and no
 * UI calls them. `@Roles()` is what admits an operational role to a route in the first place
 * (ADR-0084), so a route that forgets it is closed, not open.
 *
 * There is deliberately no endpoint that edits an order's customer or order data: whether QC may
 * revise a converted order is the one clarification still open with the client.
 *
 * Every order returned also carries `allowedActions`, computed from the same `ACTION_ROLES`
 * these routes read — advisory for the UI only. These routes and the transition table remain
 * the authority; a caller that ignores the list is refused exactly as before.
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
    @Body() dto: QcDecisionDto,
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
}
