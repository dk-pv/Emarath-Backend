import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  LogisticsStatus,
  Prisma,
  UserRole,
} from '../../generated/prisma/client';
import { allowedActions } from '../logistics-roles';
import { LogisticsAction } from '../logistics-status';

const MAX_PAGE_SIZE = 200;

/** The Logistics work queue: one page of orders, newest first. */
export class ListLogisticsOrdersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE, { message: `size must be at most ${MAX_PAGE_SIZE}` })
  size: number = 50;

  /** One lifecycle status to narrow to. */
  @IsOptional()
  @IsIn(Object.values(LogisticsStatus))
  status?: LogisticsStatus;

  /** The lead whose order to read — how a Lead screen asks for its own order. */
  @IsOptional()
  @IsUUID()
  leadId?: string;

  /** Free text over what the queue shows; blank is no filter. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** QC's note on a verification or a rejection. */
export class QcDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

/**
 * Dispatch. The AWB is required and must not be blank: the client's rule is that a tracking
 * number exists before an order ships, so the transition is refused without one.
 */
export class DispatchOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'awbNumber is required before dispatch' })
  @MaxLength(64)
  awbNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  courier?: string;
}

/** Why an order was cancelled or returned. */
export class OrderReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** One order as the API returns it. Money and quantities are strings — never floats. */
export interface LogisticsOrderResponse {
  id: string;
  orderNumber: number;
  leadId: string;
  status: LogisticsStatus;
  statusChangedAt: string;
  convertedAt: string;
  convertedById: string | null;
  customerName: string;
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  street: string | null;
  nationalCode: string | null;
  product: string | null;
  productQty: string | null;
  product2: string | null;
  product2Qty: string | null;
  orderValue: string | null;
  paymentMethod: string | null;
  qcDecidedAt: string | null;
  qcRemarks: string | null;
  awbNumber: string | null;
  courier: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  rtoAt: string | null;
  rtoReason: string | null;
  /**
   * What this caller may do to the order now (`allowedActions`, logistics-roles.ts). Advisory:
   * the UI renders it instead of working out permissions itself; the routes stay the authority.
   */
  allowedActions: LogisticsAction[];
}

export interface LogisticsOrderListResponse {
  rows: LogisticsOrderResponse[];
  total: number;
}

/** Everything the response needs, declared once so query and mapper cannot drift. */
export const LOGISTICS_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  leadId: true,
  status: true,
  statusChangedAt: true,
  convertedAt: true,
  convertedById: true,
  customerName: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  country: true,
  state: true,
  city: true,
  street: true,
  nationalCode: true,
  product: true,
  productQty: true,
  product2: true,
  product2Qty: true,
  orderValue: true,
  paymentMethod: true,
  qcDecidedAt: true,
  qcRemarks: true,
  awbNumber: true,
  courier: true,
  dispatchedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancelReason: true,
  rtoAt: true,
  rtoReason: true,
} satisfies Prisma.LogisticsOrderSelect;

type LogisticsOrderRow = Prisma.LogisticsOrderGetPayload<{
  select: typeof LOGISTICS_ORDER_SELECT;
}>;

/** The order as `role` receives it — its actions depend on who is asking. */
export function toLogisticsOrderResponse(
  row: LogisticsOrderRow,
  role: UserRole,
): LogisticsOrderResponse {
  return {
    ...row,
    allowedActions: allowedActions(row.status, role),
    statusChangedAt: row.statusChangedAt.toISOString(),
    convertedAt: row.convertedAt.toISOString(),
    productQty: row.productQty?.toString() ?? null,
    product2Qty: row.product2Qty?.toString() ?? null,
    orderValue: row.orderValue?.toString() ?? null,
    qcDecidedAt: row.qcDecidedAt?.toISOString() ?? null,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    rtoAt: row.rtoAt?.toISOString() ?? null,
  };
}
