import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  LogisticsStatus,
  Prisma,
  UserRole,
} from '../../generated/prisma/client';
import { allowedActions, OrderAction } from '../logistics-roles';

const MAX_PAGE_SIZE = 200;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What a `Decimal(12, 2)` column can hold exactly: at most ten integer digits and two decimals.
 * Anything wider would be rounded by Postgres (and audited as the unrounded value) or refused
 * with a 500. The sign is left as the lead form leaves it.
 */
const DECIMAL_12_2 = /^-?\d{1,10}(\.\d{1,2})?$/;

/** An optional field sent blank means "clear it", so blank becomes null rather than absent. */
const blankToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? null : trimmed;
};

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

/** An optional note: QC's on a verification (Q4), the resubmitter's on a resubmit. */
export class QcDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

/**
 * A QC rejection. The reason is mandatory (Q4) and may be free text — the client allows "a
 * fixed list or free text", and no list has been supplied — so blank or whitespace is refused.
 */
export class QcRejectDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required' })
  @MaxLength(2000)
  remarks!: string;
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

/**
 * Why an order was cancelled or returned — mandatory for both (Q7, Q8), so blank or whitespace
 * is refused. The client wants each chosen from a fixed list, but has not supplied either list
 * (open client questions Q12 cancellation, Q13 RTO); until it does, the reason is required free
 * text rather than a list invented here. The lists, once supplied, are checked here.
 */
export class OrderReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A reason is required' })
  @MaxLength(500)
  reason!: string;
}

/** A corrected tracking number, after dispatch (Q9). Unique, like any AWB. */
export class CorrectAwbDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'awbNumber is required' })
  @MaxLength(64)
  awbNumber!: string;
}

/**
 * The Logistics Manager's correction of a QC-verified order (Q5): the order's own copy of the
 * customer and order data, as `LogisticsOrder` stores it. Every field is optional — absent
 * means unchanged. The two the order cannot be without may not be blanked; any other field
 * sent blank is cleared. Bounds are the columns', the rules the lead form's own.
 */
export class UpdateLogisticsOrderDto {
  @ValidateIf((dto: UpdateLogisticsOrderDto) => dto.customerName !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Customer Name is required' })
  @MaxLength(180)
  customerName?: string;

  @ValidateIf((dto: UpdateLogisticsOrderDto) => dto.primaryPhone !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Primary Phone is required' })
  @MaxLength(32)
  primaryPhone?: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  secondaryPhone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(180)
  email?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(240)
  street?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(240)
  nationalCode?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(180)
  product?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(DECIMAL_12_2, {
    message: 'QTY must be a number with at most 10 digits and 2 decimals',
  })
  productQty?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(180)
  product2?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(DECIMAL_12_2, {
    message:
      'QTY of Product 2 must be a number with at most 10 digits and 2 decimals',
  })
  product2Qty?: string | null;

  /** Editable pending open client question Q17. */
  @Transform(blankToNull)
  @IsOptional()
  @Matches(DECIMAL_12_2, {
    message:
      'Order Value must be a number with at most 10 digits and 2 decimals',
  })
  orderValue?: string | null;

  /** Editable pending open client question Q17. */
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethod?: string | null;
}

/**
 * The order fields the Manager's edit may change — exactly the DTO's. `orderValue` and
 * `paymentMethod` are editable pending open client question Q17; if the client refuses, remove
 * them here, from `UpdateLogisticsOrderDto` and from the frontend's `ORDER_EDIT_FIELDS`.
 */
export const EDITABLE_ORDER_FIELDS = [
  'customerName',
  'primaryPhone',
  'secondaryPhone',
  'email',
  'country',
  'state',
  'city',
  'street',
  'nationalCode',
  'product',
  'productQty',
  'product2',
  'product2Qty',
  'orderValue',
  'paymentMethod',
] as const satisfies readonly (keyof UpdateLogisticsOrderDto)[];

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
  allowedActions: OrderAction[];
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

export type LogisticsOrderRow = Prisma.LogisticsOrderGetPayload<{
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
