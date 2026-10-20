import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import {
  LogisticsStatus,
  Prisma,
  UserRole,
} from '../../generated/prisma/client';
import { allowedActions, OrderAction } from '../logistics-roles';
import {
  BusinessDay,
  DELIVERY_BUCKETS,
  DELIVERY_DAY_FORMAT_MESSAGE,
  DeliveryBucket,
  deliveryBucketOf,
  fromDbDate,
  isDateOnly,
} from '../delivery-date';
import {
  MAX_FILTER_VALUES,
  MAX_SEARCH_LENGTH,
} from '../../leads/dto/list-leads-query.dto';
import { normalizeFilterValues } from '../../leads/lead-filter';

const MAX_PAGE_SIZE = 200;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `?city=A&city=B` or a single `?city=A`, blanks dropped — the Leads list's own coercion. */
const toFilterValues = ({ value }: { value: unknown }): unknown =>
  normalizeFilterValues(value);

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

/**
 * A delivery date: a real calendar day, `YYYY-MM-DD` (ADR-0094). Every order must have one (client,
 * 2026-10-17), so a date sent empty — null, or blank, which `blankToNull` makes null — is refused
 * as a clear rather than as a malformed day.
 */
@ValidatorConstraint({ name: 'deliveryDay', async: false })
class DeliveryDay implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isDateOnly(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return args.value === null || args.value === undefined
      ? 'Delivery Date is required; an order’s delivery date can’t be cleared'
      : DELIVERY_DAY_FORMAT_MESSAGE;
  }
}

/**
 * What narrows the queue — shared by the list and its counts, so the numbers above the list
 * always describe the rows the same filters return. Each multi-value filter matches any of its
 * values; different filters must all match.
 */
export class LogisticsOrderFiltersDto {
  /** The lead whose order to read — how a Lead screen asks for its own order. */
  @IsOptional()
  @IsUUID()
  leadId?: string;

  /** Free text over what the queue shows; blank is no filter. The platform's list limit. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH, {
    message: `search must be at most ${MAX_SEARCH_LENGTH} characters`,
  })
  search?: string;

  /** The lifecycle statuses to narrow to. */
  @Transform(toFilterValues)
  @IsArray({ message: 'status must be one or more values' })
  @IsIn(Object.values(LogisticsStatus), {
    each: true,
    message: `each status must be one of: ${Object.values(LogisticsStatus).join(', ')}`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `status accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  status?: LogisticsStatus[];

  /** Countries, matched exactly as the order stores them. The column's length is the cap. */
  @Transform(toFilterValues)
  @IsArray({ message: 'country must be one or more values' })
  @IsString({ each: true, message: 'each country must be a string' })
  @MaxLength(64, {
    each: true,
    message: 'each country must be at most 64 characters',
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `country accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  country?: string[];

  /** Cities, matched exactly as stored: free text on the lead form, so spellings are distinct. */
  @Transform(toFilterValues)
  @IsArray({ message: 'city must be one or more values' })
  @IsString({ each: true, message: 'each city must be a string' })
  @MaxLength(120, {
    each: true,
    message: 'each city must be at most 120 characters',
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `city accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  city?: string[];

  /**
   * Areas: the order's State — the lead form's first-level region of its country (an Emirate, a
   * Saudi province) — matched exactly as stored. The column's length is the cap.
   */
  @Transform(toFilterValues)
  @IsArray({ message: 'state must be one or more values' })
  @IsString({ each: true, message: 'each state must be a string' })
  @MaxLength(120, {
    each: true,
    message: 'each state must be at most 120 characters',
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `state accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  state?: string[];

  /** Delivery partners: the courier recorded at dispatch, matched exactly as stored. */
  @Transform(toFilterValues)
  @IsArray({ message: 'courier must be one or more values' })
  @IsString({ each: true, message: 'each courier must be a string' })
  @MaxLength(64, {
    each: true,
    message: 'each courier must be at most 64 characters',
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `courier accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  courier?: string[];

  /**
   * Sales executives: the users the order's lead is assigned to now (`LeadAssignment`), the same
   * relation and parameter name as the Leads list's `assignedAgent` filter.
   */
  @Transform(toFilterValues)
  @IsArray({ message: 'assignedAgent must be one or more values' })
  @IsUUID('all', {
    each: true,
    message: 'each assignedAgent must be a user id',
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `assignedAgent accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  assignedAgent?: string[];

  /** Delivery-date buckets, measured against the business day (ADR-0094). */
  @Transform(toFilterValues)
  @IsArray({ message: 'delivery must be one or more values' })
  @IsIn(DELIVERY_BUCKETS, {
    each: true,
    message: `each delivery must be one of: ${DELIVERY_BUCKETS.join(', ')}`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `delivery accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  delivery?: DeliveryBucket[];

  /**
   * One delivery day, `YYYY-MM-DD` — an alternative to the buckets, as a filter's values are: an
   * order matches a chosen bucket or this day (ADR-0094).
   */
  @IsOptional()
  @Validate(DeliveryDay, {
    message:
      'deliveryOn must be a real date written YYYY-MM-DD (years 2000-2099)',
  })
  deliveryOn?: string;
}

/** The columns the queue can be ordered by — a whitelist, never a raw column name. */
export const LOGISTICS_SORT_COLUMNS = [
  'orderNumber',
  'customerName',
  'status',
  'convertedAt',
  'statusChangedAt',
  'deliveryDate',
] as const;
export type LogisticsSortColumn = (typeof LOGISTICS_SORT_COLUMNS)[number];

/** The Logistics work queue: one page of orders, newest first unless sorted otherwise. */
export class ListLogisticsOrdersDto extends LogisticsOrderFiltersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE, { message: `size must be at most ${MAX_PAGE_SIZE}` })
  size: number = 50;

  @IsOptional()
  @IsIn(LOGISTICS_SORT_COLUMNS, {
    message: `sort must be one of: ${LOGISTICS_SORT_COLUMNS.join(', ')}`,
  })
  sort: LogisticsSortColumn = 'convertedAt';

  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'direction must be asc or desc' })
  direction: 'asc' | 'desc' = 'desc';
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
 * Sales' requested delivery day, before QC verifies the order (Phase 2D, ADR-0094): a real
 * calendar day written `YYYY-MM-DD`. It can be changed but never cleared — every order must have
 * a delivery date (client, 2026-10-17) — so null, blank and an empty body are all refused.
 * Whether the day may be before today is the service's rule, because "today" is the business
 * timezone's.
 */
export class SetDeliveryDateDto {
  @Transform(blankToNull)
  @Validate(DeliveryDay)
  deliveryDate!: string;
}

/**
 * The Logistics team's correction of the delivery date of an order QC has verified (client,
 * 2026-10-17): a real `YYYY-MM-DD` day — required, never null or blank — and why it changed,
 * required too. Whether the day may be before today is the service's rule (today or later).
 */
export class CorrectDeliveryDateDto {
  @Transform(blankToNull)
  @Validate(DeliveryDay)
  deliveryDate!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A reason for the correction is required' })
  @MaxLength(500)
  reason!: string;
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

  /**
   * The planned delivery day, `YYYY-MM-DD` (ADR-0094), following this edit's rules: the Logistics
   * Manager, while the order is QC Verified. Absent leaves it as it is; unlike the other fields it
   * can't be cleared — null or blank is refused — because every order must have a delivery date
   * (client, 2026-10-17).
   */
  @Transform(blankToNull)
  @ValidateIf((dto: UpdateLogisticsOrderDto) => dto.deliveryDate !== undefined)
  @Validate(DeliveryDay)
  deliveryDate?: string;
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
  'deliveryDate',
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
  /** The planned delivery day, `YYYY-MM-DD`, or null when none is set. */
  deliveryDate: string | null;
  /**
   * Where that date stands on today's business day (ADR-0094) — worked out here, so no browser
   * clock decides it. Null for a past date whose delivery already has an outcome.
   */
  deliveryBucket: DeliveryBucket | null;
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

/** How many orders hold one country, city or area value; `null` is an order with none recorded. */
export interface RegionCount {
  value: string | null;
  count: number;
}

/**
 * How many of the caller's orders the filters select: per status (every status present, zero
 * included) and per country, city and area — most orders first, then by name, none recorded last.
 */
export interface LogisticsOrderSummaryResponse {
  counts: Record<LogisticsStatus, number>;
  total: number;
  countries: RegionCount[];
  cities: RegionCount[];
  /** Per area: the order's State, the field the Area filter matches (ADR-0094, 2026-10-17). */
  states: RegionCount[];
  /** The business day the delivery buckets were measured against, and its timezone. */
  businessDay: BusinessDay;
}

/** One day of the delivery schedule: its orders, and how many hold each status (zero included). */
export interface DeliveryScheduleDay {
  date: string;
  total: number;
  counts: Record<LogisticsStatus, number>;
}

/**
 * How many of the caller's orders every filter but the delivery date's own selects — per delivery
 * bucket, and per day for the `DELIVERY_SCHEDULE_DAYS` days from the business day's today, every
 * day present. Each count is the list's total for that bucket or that day under the same filters.
 */
export interface LogisticsDeliveryScheduleResponse {
  businessDay: BusinessDay;
  buckets: Record<DeliveryBucket, number>;
  days: DeliveryScheduleDay[];
}

/** A sales executive the filter offers: a user one of the caller's orders' leads is assigned to. */
export interface LogisticsAssigneeOption {
  id: string;
  name: string;
}

/** The values the caller's own orders hold — the filter's choices. */
export interface LogisticsOrderFilterOptions {
  countries: string[];
  cities: string[];
  states: string[];
  couriers: string[];
  assignees: LogisticsAssigneeOption[];
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
  deliveryDate: true,
} satisfies Prisma.LogisticsOrderSelect;

export type LogisticsOrderRow = Prisma.LogisticsOrderGetPayload<{
  select: typeof LOGISTICS_ORDER_SELECT;
}>;

/**
 * The order as `role` receives it — its actions depend on who is asking, and on whether its lead
 * sits in a pipeline closed to them (`leadClosed`) — with its delivery date placed on `day`, the
 * business day of the request.
 */
export function toLogisticsOrderResponse(
  row: LogisticsOrderRow,
  role: UserRole,
  day: BusinessDay,
  leadClosed = false,
): LogisticsOrderResponse {
  const deliveryDate = row.deliveryDate ? fromDbDate(row.deliveryDate) : null;
  return {
    ...row,
    deliveryDate,
    deliveryBucket: deliveryBucketOf(deliveryDate, row.status, day),
    allowedActions: allowedActions(
      row.status,
      role,
      leadClosed,
      deliveryDate !== null,
    ),
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
