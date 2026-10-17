import { BadRequestException } from '@nestjs/common';
import { LogisticsStatus, Prisma } from '../generated/prisma/client';

/**
 * An order's delivery date and the day buckets Logistics plans by (ADR-0094).
 *
 * A delivery date is a calendar day, not an instant: a DATE column, carried as `YYYY-MM-DD`, and
 * never put through a local-time `Date`, so it cannot shift a day in any timezone. Which day is
 * "today" is the business's — never the server's or the browser's — worked out in the one IANA
 * timezone the deployment configures (`BUSINESS_TIME_ZONE`), because GCC countries do not share a
 * clock: Asia/Dubai and Asia/Muscat are UTC+4, Asia/Riyadh (Saudi Arabia, Qatar, Kuwait, Bahrain)
 * UTC+3. The buckets are worked out when orders are read, so nothing moves an order between them.
 */

export const DELIVERY_BUCKETS = [
  'today',
  'tomorrow',
  'future',
  'overdue',
  'none',
] as const;
export type DeliveryBucket = (typeof DELIVERY_BUCKETS)[number];

/**
 * The statuses in which an order's delivery has an outcome — delivered, cancelled or returned to
 * origin. A past date on one of them is history, not an overdue delivery. These are lifecycle
 * statuses as they are; a bucket never changes one.
 */
export const DELIVERY_OUTCOME_STATUSES: readonly LogisticsStatus[] = [
  LogisticsStatus.DELIVERED,
  LogisticsStatus.CANCELLED,
  LogisticsStatus.RTO,
];

/** The business day the buckets are measured against, and the timezone it was read in. */
export interface BusinessDay {
  timeZone: string;
  today: string;
  tomorrow: string;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` is a real calendar day written `YYYY-MM-DD`. Years outside 2000–2099 are refused
 * as typing slips (a "0026" or "20266" year), not as a business rule.
 */
export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 2000 || year > 2099) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** What a delivery date that is not a real `YYYY-MM-DD` day is refused with. */
export const DELIVERY_DAY_FORMAT_MESSAGE =
  'Delivery Date must be a real date written YYYY-MM-DD (years 2000-2099)';

/**
 * Refuses, with a 400, a requested delivery day that is not a real `YYYY-MM-DD` day or is before
 * the business day's today — measured in the business timezone (`BUSINESS_TIME_ZONE`, Asia/Dubai),
 * never the server's or the browser's. Today itself is allowed. The one rule for a day someone
 * asks for, so every route that takes one refuses the same days with the same words.
 */
export function assertRequestedDeliveryDay(
  day: string,
  business: BusinessDay,
): void {
  if (!isDateOnly(day)) {
    throw new BadRequestException(DELIVERY_DAY_FORMAT_MESSAGE);
  }
  if (day < business.today) {
    const shown = business.today.split('-').reverse().join('-');
    throw new BadRequestException(
      `The delivery date can’t be before today, ${shown} (${business.timeZone}).`,
    );
  }
}

/** The DATE column's value for a day: its UTC midnight, which the column stores as the day. */
export function toDbDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The day a DATE column holds, as `YYYY-MM-DD`. */
export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The day `count` days after `day`, on the calendar alone — no timezone is involved. */
export function addDays(day: string, count: number): string {
  const date = toDbDate(day);
  date.setUTCDate(date.getUTCDate() + count);
  return fromDbDate(date);
}

/** How many days the delivery schedule counts, starting with the business day's today. */
export const DELIVERY_SCHEDULE_DAYS = 14;

/** Today and tomorrow in `timeZone` at the instant `now`. */
export function businessDay(
  timeZone: string,
  now: Date = new Date(),
): BusinessDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)?.value ?? '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  return { timeZone, today, tomorrow: addDays(today, 1) };
}

/**
 * The orders in any of `buckets` on `day`, or due on the one day `on`, as one more AND term of the
 * shared Logistics filter, so the List, every Pipeline column and the counts read the same orders.
 * Today and Tomorrow are exactly those days; Future is after tomorrow; Overdue is before today
 * without an outcome; None is no date at all. Like every other filter's values, the buckets and the
 * day are alternatives: an order matches any of them.
 */
export function deliveryBucketWhere(
  buckets: readonly DeliveryBucket[] | undefined,
  day: BusinessDay,
  on?: string,
): Prisma.LogisticsOrderWhereInput {
  const onDay: Prisma.LogisticsOrderWhereInput[] = on
    ? [{ deliveryDate: toDbDate(on) }]
    : [];
  if (!buckets?.length) return onDay.length ? { OR: onDay } : {};
  const today = toDbDate(day.today);
  const tomorrow = toDbDate(day.tomorrow);
  const terms: Record<DeliveryBucket, Prisma.LogisticsOrderWhereInput> = {
    today: { deliveryDate: today },
    tomorrow: { deliveryDate: tomorrow },
    future: { deliveryDate: { gt: tomorrow } },
    overdue: {
      deliveryDate: { lt: today },
      status: { notIn: [...DELIVERY_OUTCOME_STATUSES] },
    },
    none: { deliveryDate: null },
  };
  return { OR: [...buckets.map((bucket) => terms[bucket]), ...onDay] };
}

/**
 * The bucket one order sits in on `day` — the same rules as `deliveryBucketWhere` — or null for a
 * past date whose delivery already has an outcome, which belongs to no bucket.
 */
export function deliveryBucketOf(
  deliveryDate: string | null,
  status: LogisticsStatus,
  day: BusinessDay,
): DeliveryBucket | null {
  if (deliveryDate === null) return 'none';
  if (deliveryDate === day.today) return 'today';
  if (deliveryDate === day.tomorrow) return 'tomorrow';
  if (deliveryDate > day.tomorrow) return 'future';
  return DELIVERY_OUTCOME_STATUSES.includes(status) ? null : 'overdue';
}
