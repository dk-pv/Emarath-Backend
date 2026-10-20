import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentStatus, Prisma, UserRole } from '../../generated/prisma/client';
import { allowedPaymentActions } from '../accounts-roles';
import { fromDbDate } from '../../logistics/delivery-date';
import {
  MAX_FILTER_VALUES,
  MAX_SEARCH_LENGTH,
} from '../../leads/dto/list-leads-query.dto';
import { normalizeFilterValues } from '../../leads/lead-filter';

const MAX_PAGE_SIZE = 200;

const PAYMENT_STATUSES = Object.values(PaymentStatus);

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `?courier=A&courier=B` or a single `?courier=A`, blanks dropped — the Leads list's coercion. */
const toFilterValues = ({ value }: { value: unknown }): unknown =>
  normalizeFilterValues(value);

/**
 * What narrows the Accounts list — shared by the list and its counts. Each multi-value filter
 * matches any of its values; different filters must all match. Payment method and courier are the
 * order's own (the method captured at conversion, the courier recorded at dispatch), so Accounts
 * can pick out, say, one courier's cash-on-delivery orders when its remittance arrives (Q16).
 */
export class AccountsRecordFiltersDto {
  /** Free text over the order: its number, the customer's name and phone, and the AWB. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH, {
    message: `search must be at most ${MAX_SEARCH_LENGTH} characters`,
  })
  search?: string;

  @Transform(toFilterValues)
  @IsArray({ message: 'status must be one or more values' })
  @IsIn(PAYMENT_STATUSES, {
    each: true,
    message: `each status must be one of: ${PAYMENT_STATUSES.join(', ')}`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `status accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  status?: PaymentStatus[];

  /** Payment methods, matched exactly as the order stores them. The column's length is the cap. */
  @Transform(toFilterValues)
  @IsArray({ message: 'paymentMethod must be one or more values' })
  @IsString({ each: true, message: 'each paymentMethod must be a string' })
  @MaxLength(64, {
    each: true,
    message: 'each paymentMethod must be at most 64 characters',
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `paymentMethod accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  paymentMethod?: string[];

  /** Couriers, matched exactly as recorded at dispatch. */
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
}

/** The columns the list can be ordered by — a whitelist, never a raw column name. */
export const ACCOUNTS_SORT_COLUMNS = [
  'deliveredAt',
  'orderNumber',
  'customerName',
  'status',
  'statusChangedAt',
] as const;
export type AccountsSortColumn = (typeof ACCOUNTS_SORT_COLUMNS)[number];

/** One page of records, the most recently delivered first unless sorted otherwise. */
export class ListAccountsRecordsDto extends AccountsRecordFiltersDto {
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
  @IsIn(ACCOUNTS_SORT_COLUMNS, {
    message: `sort must be one of: ${ACCOUNTS_SORT_COLUMNS.join(', ')}`,
  })
  sort: AccountsSortColumn = 'deliveredAt';

  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'direction must be asc or desc' })
  direction: 'asc' | 'desc' = 'desc';
}

/**
 * A payment-status move. `expectedStatus` is the status the caller saw: the move is made only if
 * the record still has it, so two people working the same record cannot overwrite each other's
 * decision unseen — the second is told what it is now.
 */
export class MovePaymentStatusDto {
  @IsEnum(PaymentStatus, {
    message: `status must be one of: ${PAYMENT_STATUSES.join(', ')}`,
  })
  status!: PaymentStatus;

  @IsEnum(PaymentStatus, {
    message: `expectedStatus must be one of: ${PAYMENT_STATUSES.join(', ')}`,
  })
  expectedStatus!: PaymentStatus;

  /** An optional note, kept on the move's event. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

/**
 * A correction (Q14): any status to any other, backwards included, with a mandatory reason — kept
 * on the event, so the history says why the status was changed.
 */
export class CorrectPaymentStatusDto {
  @IsEnum(PaymentStatus, {
    message: `status must be one of: ${PAYMENT_STATUSES.join(', ')}`,
  })
  status!: PaymentStatus;

  @IsEnum(PaymentStatus, {
    message: `expectedStatus must be one of: ${PAYMENT_STATUSES.join(', ')}`,
  })
  expectedStatus!: PaymentStatus;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A reason for the correction is required' })
  @MaxLength(500)
  reason!: string;
}

/** The order a record belongs to, as Accounts needs to see it. Money is a string — never a float. */
export interface AccountsRecordOrder {
  id: string;
  orderNumber: number;
  leadId: string;
  customerName: string;
  primaryPhone: string;
  country: string | null;
  city: string | null;
  product: string | null;
  orderValue: string | null;
  paymentMethod: string | null;
  awbNumber: string | null;
  courier: string | null;
  deliveredAt: string | null;
  /** The planned delivery day, `YYYY-MM-DD`. */
  deliveryDate: string | null;
}

/** One record as the API returns it. */
export interface AccountsRecordResponse {
  id: string;
  status: PaymentStatus;
  statusChangedAt: string;
  createdAt: string;
  order: AccountsRecordOrder;
  /**
   * What this caller may do now (`allowedPaymentActions`). Advisory: the UI renders it instead of
   * working out permissions itself; the routes stay the authority.
   */
  allowedMoves: PaymentStatus[];
  canCorrect: boolean;
}

export interface AccountsRecordListResponse {
  rows: AccountsRecordResponse[];
  total: number;
}

/**
 * How many records each status holds under the list's filters other than status (every status
 * present, zero included), and their total — the number of delivered orders those filters select.
 */
export interface AccountsRecordSummaryResponse {
  counts: Record<PaymentStatus, number>;
  total: number;
}

/** The payment methods and couriers the caller's records' orders hold — the filter's choices. */
export interface AccountsRecordFilterOptions {
  paymentMethods: string[];
  couriers: string[];
}

/** Everything the response needs, declared once so query and mapper cannot drift. */
export const ACCOUNTS_RECORD_SELECT = {
  id: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      leadId: true,
      customerName: true,
      primaryPhone: true,
      country: true,
      city: true,
      product: true,
      orderValue: true,
      paymentMethod: true,
      awbNumber: true,
      courier: true,
      deliveredAt: true,
      deliveryDate: true,
    },
  },
} satisfies Prisma.AccountsRecordSelect;

export type AccountsRecordRow = Prisma.AccountsRecordGetPayload<{
  select: typeof ACCOUNTS_RECORD_SELECT;
}>;

/** The record as `role` receives it: its actions depend on who is asking. */
export function toAccountsRecordResponse(
  row: AccountsRecordRow,
  role: UserRole,
): AccountsRecordResponse {
  const { moves, canCorrect } = allowedPaymentActions(row.status, role);
  return {
    id: row.id,
    status: row.status,
    statusChangedAt: row.statusChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    order: {
      ...row.order,
      orderValue: row.order.orderValue?.toString() ?? null,
      deliveredAt: row.order.deliveredAt?.toISOString() ?? null,
      deliveryDate: row.order.deliveryDate
        ? fromDbDate(row.order.deliveryDate)
        : null,
    },
    allowedMoves: moves,
    canCorrect,
  };
}
