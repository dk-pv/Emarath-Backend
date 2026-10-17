import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { AuditActor, AuditEventInput } from '../audit/audit-events';
import { AppConfig } from '../config/configuration';
import { CONVERTED_STATUS } from '../reports/converted-leads-where';
import {
  assertRequestedDeliveryDay,
  BusinessDay,
  businessDay,
  toDbDate,
} from './delivery-date';

/**
 * Won lead → Logistics order (ADR-0085 B7–B9).
 *
 * One function, called from the two lead-write chokepoints, so every path that can make a lead
 * WON creates its order the same way, inside the same transaction as the status write: the
 * order, the lead and every audit event commit or roll back together.
 *
 * It is deliberately independent of the leads module — it takes the lead's after-state as data,
 * not a Prisma row — so `lead-audit.ts` can import it without the two forming a cycle.
 */

/**
 * The lead fields the snapshot copies. A structural subset of `LeadAuditState`, so the
 * chokepoints pass the after-state they have already read: **no extra read of the lead**.
 * Decimals arrive as exact strings, which both Prisma's Decimal inputs and JSON accept.
 */
export interface ConvertibleLeadState {
  status: string;
  archived: boolean;
  name: string;
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
  actualAmount: string | null;
  paymentMethod: string | null;
}

/** The delivery day a converting request asks for, with the business day it is measured on. */
export interface RequestedDeliveryDate {
  day: string;
  businessDay: BusinessDay;
}

export interface LeadConversionContext {
  actor: AuditActor;
  source: string;
  /**
   * The requested delivery day, sent by a request that converts a lead. Every new order must have
   * one (client, 2026-10-17): it is required whenever this call creates an order and refused when
   * it creates none. Never the lead's Booking Date, and never defaulted to today.
   */
  deliveryDate?: RequestedDeliveryDate;
}

export const DELIVERY_DATE_REQUIRED_MESSAGE =
  'A Delivery Date is required to convert a lead to WON.';
export const DELIVERY_DATE_NOT_CONVERTING_MESSAGE =
  'A Delivery Date is only accepted when the request converts a lead to WON.';

/**
 * The requested delivery day a request carries — measured against today's business day in
 * `BUSINESS_TIME_ZONE` (Asia/Dubai) — or undefined when it carries none.
 */
export function requestedDeliveryDate(
  day: string | undefined,
  config: ConfigService,
): RequestedDeliveryDate | undefined {
  return day === undefined
    ? undefined
    : {
        day,
        businessDay: businessDay(
          config.getOrThrow<AppConfig>('app').businessTimeZone,
        ),
      };
}

export interface LeadConversion {
  /** The order each converted lead now has — the one just created, or the one it already had. */
  orderIdByLead: Map<string, string>;
  /** `LOGISTICS_ORDER / CREATED` for the orders this call actually inserted. */
  events: AuditEventInput[];
}

/**
 * Did this change convert the lead? The one definition every caller shares, so an audit event
 * and an order can never disagree about what "converted" means.
 *
 * `before` is undefined for a lead that has just been created, which is how create, duplicate
 * and import converge on the same rule: a lead created as WON converts (ADR-0085 B8). A lead
 * that was already WON and is merely edited does not convert again.
 */
export function becameConverted(
  before: { status: string } | undefined,
  after: { status: string },
): boolean {
  return (
    after.status === CONVERTED_STATUS && before?.status !== CONVERTED_STATUS
  );
}

/**
 * Creates the orders for leads that have just become WON, and says which order each one has.
 *
 * `skipDuplicates` makes this idempotent and is what enforces CD-2 in practice: `lead_id` is
 * UNIQUE, so a lead that already has an order — a re-conversion after a QC rejection, a retried
 * request, two concurrent writers — keeps the order it has. `INSERT … ON CONFLICT DO NOTHING`
 * also means no unique violation is ever raised inside the transaction, which would abort it
 * (Postgres does not let a failed statement be caught without a savepoint).
 *
 * Every new order must have a delivery date (client, 2026-10-17). The requested day is checked
 * by the shared rule before anything is written and stored on the order in the same insert;
 * a call that creates an order without one, or sends one and creates none, is a 400 that rolls
 * the whole transaction back — the lead's change included. The day is recorded as Sales' own
 * date event (`logistics.delivery_date`), beside the order's creation, not inside its snapshot.
 */
export async function convertLeadsToOrders(
  tx: Prisma.TransactionClient,
  leads: { id: string; state: ConvertibleLeadState }[],
  context: LeadConversionContext,
): Promise<LeadConversion> {
  const requested = context.deliveryDate;
  if (leads.length === 0) {
    if (requested) {
      throw new BadRequestException(DELIVERY_DATE_NOT_CONVERTING_MESSAGE);
    }
    return { orderIdByLead: new Map(), events: [] };
  }
  if (requested) {
    assertRequestedDeliveryDay(requested.day, requested.businessDay);
  }

  const convertedAt = new Date();
  const convertedById = context.actor.type === 'USER' ? context.actor.id : null;

  const inserted = await tx.logisticsOrder.createManyAndReturn({
    data: leads.map(({ id, state }) => ({
      leadId: id,
      convertedAt,
      convertedById,
      ...snapshot(state),
      deliveryDate: requested ? toDbDate(requested.day) : null,
    })),
    skipDuplicates: true,
    select: { id: true, leadId: true, orderNumber: true, status: true },
  });
  if (inserted.length > 0 && !requested) {
    throw new BadRequestException(DELIVERY_DATE_REQUIRED_MESSAGE);
  }
  if (inserted.length === 0 && requested) {
    throw new BadRequestException(DELIVERY_DATE_NOT_CONVERTING_MESSAGE);
  }

  // A skipped lead already had an order; its CONVERTED event still has to name it.
  const skipped = leads
    .filter(({ id }) => !inserted.some((order) => order.leadId === id))
    .map(({ id }) => id);
  const existing =
    skipped.length > 0
      ? await tx.logisticsOrder.findMany({
          where: { leadId: { in: skipped } },
          select: { id: true, leadId: true },
        })
      : [];

  const orderIdByLead = new Map<string, string>(
    [...inserted, ...existing].map((order) => [order.leadId, order.id]),
  );
  const stateByLead = new Map(leads.map(({ id, state }) => [id, state]));

  return {
    orderIdByLead,
    events: inserted.flatMap((order): AuditEventInput[] => [
      {
        entityType: 'LOGISTICS_ORDER',
        entityId: order.id,
        leadId: order.leadId,
        action: 'CREATED',
        actor: context.actor,
        source: context.source,
        after: {
          orderNumber: order.orderNumber,
          status: order.status,
          ...snapshot(stateByLead.get(order.leadId)!),
        },
      },
      // `requested` is set whenever an order was inserted (refused above otherwise).
      {
        entityType: 'LOGISTICS_ORDER',
        entityId: order.id,
        leadId: order.leadId,
        action: 'UPDATED',
        actor: context.actor,
        source: 'logistics.delivery_date',
        before: { deliveryDate: null },
        after: { deliveryDate: requested!.day },
      },
    ]),
  };
}

/**
 * The order's copy of the customer and the order itself, taken once at conversion so a later
 * edit to the lead cannot silently change what is shipped or billed (ADR-0085 B5). Two columns
 * are named for the order rather than the lead: `customerName` and `orderValue`.
 */
function snapshot(state: ConvertibleLeadState) {
  return {
    customerName: state.name,
    primaryPhone: state.primaryPhone,
    secondaryPhone: state.secondaryPhone,
    email: state.email,
    country: state.country,
    state: state.state,
    city: state.city,
    street: state.street,
    nationalCode: state.nationalCode,
    product: state.product,
    productQty: state.productQty,
    product2: state.product2,
    product2Qty: state.product2Qty,
    orderValue: state.actualAmount,
    paymentMethod: state.paymentMethod,
  };
}
