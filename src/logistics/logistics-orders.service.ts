import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogisticsStatus, Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/configuration';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { recordAuditEvents, userActor } from '../audit/audit-events';
import { openAccountsRecord } from '../accounts/accounts-record';
import { applyLeadChanges } from '../leads/lead-audit';
import { escapeLike } from '../leads/lead-search';
import { assertMayChangeLead } from '../pipelines/pipeline-access';
import { CONVERTED_STATUS } from '../reports/converted-leads-where';
import {
  DATE_REQUIRED_ACTIONS,
  logisticsOrderScopeWhere,
} from './logistics-roles';
import {
  addDays,
  assertRequestedDeliveryDay,
  BusinessDay,
  businessDay,
  DELIVERY_BUCKETS,
  DELIVERY_SCHEDULE_DAYS,
  DeliveryBucket,
  deliveryBucketOf,
  deliveryBucketWhere,
  fromDbDate,
  toDbDate,
} from './delivery-date';
import {
  LOGISTICS_TRANSITIONS,
  LogisticsAction,
  ORDER_EDIT_STATUSES,
  OrderEdit,
  QC_REJECTED_LEAD_STATUS,
} from './logistics-status';
import {
  CorrectAwbDto,
  CorrectDeliveryDateDto,
  DispatchOrderDto,
  EDITABLE_ORDER_FIELDS,
  ListLogisticsOrdersDto,
  LOGISTICS_ORDER_SELECT,
  LogisticsDeliveryScheduleResponse,
  LogisticsOrderFilterOptions,
  LogisticsOrderFiltersDto,
  LogisticsOrderListResponse,
  LogisticsOrderResponse,
  LogisticsOrderRow,
  LogisticsOrderSummaryResponse,
  OrderReasonDto,
  QcDecisionDto,
  QcRejectDto,
  RegionCount,
  SetDeliveryDateDto,
  toLogisticsOrderResponse,
  UpdateLogisticsOrderDto,
} from './dto/logistics-order.dto';

/** The editable fields stored as decimals, compared by value rather than by spelling. */
const DECIMAL_FIELDS: ReadonlySet<string> = new Set([
  'productQty',
  'product2Qty',
  'orderValue',
]);

/** Why an edit is refused from a status it may not be made in — after "This order is <status>;". */
const EDIT_REFUSAL: Readonly<Record<OrderEdit, string>> = {
  EDIT: 'it can only be edited while QC_VERIFIED',
  CORRECT_AWB: 'its AWB can only be corrected after dispatch',
  SET_DELIVERY_DATE:
    'its delivery date can only be set while INITIAL or QC_REJECTED',
  CORRECT_DELIVERY_DATE:
    'its delivery date can only be corrected while QC_VERIFIED or DISPATCHED',
};

/**
 * Free text over what the queue shows — the order number, the customer's name and phone, and
 * the AWB — matched as the other lists match: case-insensitive, with `%`/`_` literal. A term
 * that is a number also matches the order number exactly, with or without the `#` it is shown
 * with. It narrows the caller's scope and can never widen it: it is one more AND term. Accounts
 * searches its records' orders with it too.
 */
export function orderSearchWhere(
  term: string | undefined,
): Prisma.LogisticsOrderWhereInput {
  const trimmed = term?.trim();
  if (!trimmed) return {};
  const contains = {
    contains: escapeLike(trimmed),
    mode: 'insensitive' as const,
  };
  const digits = trimmed.replace(/^#/, '');
  return {
    OR: [
      // Nine digits at most, so the number always fits the INTEGER column.
      ...(/^\d{1,9}$/.test(digits) ? [{ orderNumber: Number(digits) }] : []),
      { customerName: contains },
      { primaryPhone: contains },
      { awbNumber: contains },
    ],
  };
}

/**
 * The orders a query reaches: the caller's scope first, then the narrowing terms, so a filter
 * can only ever narrow it. The list, the board's columns and the counts all build their `where`
 * here, which is what keeps the numbers above the queue in step with its rows. Delivery buckets
 * are measured against `day`, the business day of the request; a chosen delivery day joins them.
 */
function orderWhere(
  user: CurrentUser,
  filters: LogisticsOrderFiltersDto,
  day: BusinessDay,
): Prisma.LogisticsOrderWhereInput {
  return {
    AND: [
      logisticsOrderScopeWhere(user),
      filters.status ? { status: { in: filters.status } } : {},
      filters.country ? { country: { in: filters.country } } : {},
      filters.city ? { city: { in: filters.city } } : {},
      filters.leadId ? { leadId: filters.leadId } : {},
      orderSearchWhere(filters.search),
      deliveryBucketWhere(filters.delivery, day, filters.deliveryOn),
      filters.state ? { state: { in: filters.state } } : {},
      filters.courier ? { courier: { in: filters.courier } } : {},
      filters.assignedAgent
        ? {
            lead: {
              assignments: { some: { userId: { in: filters.assignedAgent } } },
            },
          }
        : {},
    ],
  };
}

/** A count for every status, each starting at zero. */
const statusCounts = (): Record<LogisticsStatus, number> =>
  Object.fromEntries(
    Object.values(LogisticsStatus).map((status) => [status, 0]),
  ) as Record<LogisticsStatus, number>;

/** A blank value is no value, so it is counted with the orders that have none. */
const recorded = (value: string | null): string | null =>
  value?.trim() ? value : null;

/** Most orders first, then by name; orders with no value recorded last. */
function regionCounts(totals: Map<string | null, number>): RegionCount[] {
  return [...totals]
    .map(([value, count]) => ({ value, count }))
    .sort(
      (a, b) =>
        Number(a.value === null) - Number(b.value === null) ||
        b.count - a.count ||
        (a.value ?? '').localeCompare(b.value ?? '', 'en'),
    );
}

/** The distinct values a column holds, blanks left out, in name order. */
const distinctValues = (values: (string | null)[]): string[] =>
  [
    ...new Set(
      values.filter((value): value is string => Boolean(value?.trim())),
    ),
  ].sort((a, b) => a.localeCompare(b, 'en'));

/**
 * The status a write-back gives the lead must be a stage of the lead's own pipeline: a status
 * no column of that board holds would drop the lead off it while the order moved on. Refusing
 * throws inside the move's transaction, so the order and the lead change together or not at
 * all. Neither stage can disappear after this check — both are reserved names, which can't be
 * renamed or deleted — and the lead's pipeline is locked while it has an order.
 */
async function assertLeadStage(
  tx: Prisma.TransactionClient,
  leadId: string,
  status: string,
): Promise<void> {
  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    select: { pipeline: true },
  });
  const stage =
    lead &&
    (await tx.stage.findUnique({
      where: { pipeline_name: { pipeline: lead.pipeline, name: status } },
      select: { id: true },
    }));
  if (!stage) {
    throw new ConflictException(
      `The lead’s pipeline “${lead?.pipeline ?? ''}” has no “${status}” stage, so this can’t be recorded and nothing was changed. Contact your administrator.`,
    );
  }
}

/**
 * An AWB is unique across orders (Q9). Checked first so the refusal names the order already
 * holding it; the unique index stays the authority, and `withAwbClash` turns the race this
 * check cannot close into a 409 as well — one that does not name the holding order.
 *
 * Matching is exact after trimming — provisional, pending client Q15 (is AWB matching
 * case-sensitive?). A case-insensitive answer changes three places together: this query, the
 * unchanged-AWB comparison in `correctAwb`, and the unique index (a new `lower(awb_number)`
 * index migration).
 */
async function assertAwbFree(
  tx: Prisma.TransactionClient,
  awbNumber: string,
  exceptOrderId: string,
): Promise<void> {
  const holder = await tx.logisticsOrder.findFirst({
    where: { awbNumber, NOT: { id: exceptOrderId } },
    select: { orderNumber: true },
  });
  if (holder) {
    throw new ConflictException(
      `AWB ${awbNumber} is already used by order #${holder.orderNumber}.`,
    );
  }
}

/** The step each date-requiring move is, as its refusal names it. */
const DATED_STEP: Partial<Record<LogisticsAction, string>> = {
  QC_VERIFY: 'QC verification',
  DISPATCH: 'dispatch',
};

/**
 * Refuses with a 409 a move that needs the order's delivery date (`DATE_REQUIRED_ACTIONS`) on an
 * order without one — every order must have a delivery date (client, 2026-10-17). Only a move the
 * order's status allows is refused here: any other keeps the status refusal it always had. The
 * date read is not locked, and need not be: no route can clear a date any more, so a dated order
 * stays dated, and an undated read that a concurrent date overtakes only refuses the move.
 */
function assertDatedFor(
  action: LogisticsAction,
  order: { status: LogisticsStatus; deliveryDate: Date | null },
): void {
  if (
    DATE_REQUIRED_ACTIONS.includes(action) &&
    LOGISTICS_TRANSITIONS[action].from.includes(order.status) &&
    order.deliveryDate === null
  ) {
    throw new ConflictException(
      `This order has no delivery date. Set one before ${DATED_STEP[action]}.`,
    );
  }
}

/** A unique-index refusal here is the AWB being taken between the check and the write. */
async function withAwbClash<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('That AWB is already used by another order.');
    }
    throw error;
  }
}

/**
 * The Logistics order lifecycle (ADR-0085, client clarifications of 2026-09-23 and 2026-10-01).
 *
 * Orders are created by conversion, never here: this service moves an existing one along the
 * state machine in `logistics-status.ts`, makes the Logistics Manager's two corrections (the
 * order's data after QC, the AWB after dispatch), and records the delivery date Sales asks for
 * before QC verifies the order (Phase 2D). Every move is a conditional update from the
 * exact status read, taken only where that table allows it, so an illegal or stale transition
 * changes nothing and comes back as a 409 naming the status the order is really in — a caller
 * cannot reach a state the table does not describe, whatever it sends. Every order is read through the caller's scope first,
 * so an order they may not see is a 404 whatever the route admitted.
 *
 * Two moves also write the lead, and both do it in the transition's own transaction: a QC
 * rejection puts the lead into `QC NOT APPROVED` (CD-1) and the controlled resubmit puts it
 * back to WON (CD-2). They go through `applyLeadChanges` — the same locked core every sales
 * write path uses, so the lead's history stays one story — with the write-back flag, which is
 * the only key that opens the converted-lead status guard.
 */
@Injectable()
export class LogisticsOrdersService {
  /** The business timezone (`BUSINESS_TIME_ZONE`), whose calendar day the buckets use. */
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    config: ConfigService,
  ) {
    this.timeZone = config.getOrThrow<AppConfig>('app').businessTimeZone;
  }

  /** Today and tomorrow in the business timezone, read once per request. */
  private businessDay(): BusinessDay {
    return businessDay(this.timeZone);
  }

  /** A scoped page of orders: Logistics and QC see every one, Sales only their own leads'. */
  async list(
    query: ListLogisticsOrdersDto,
  ): Promise<LogisticsOrderListResponse> {
    const user = await this.currentUser.resolve();
    const day = this.businessDay();
    const where = orderWhere(user, query, day);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.logisticsOrder.findMany({
        where,
        select: LOGISTICS_ORDER_SELECT,
        // `sort` is one of the DTO's whitelisted columns; `id` breaks ties so a row never
        // repeats across pages. Orders without a delivery date sort last either way.
        orderBy: [
          query.sort === 'deliveryDate'
            ? { deliveryDate: { sort: query.direction, nulls: 'last' } }
            : { [query.sort]: query.direction },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.logisticsOrder.count({ where }),
    ]);

    const closed = await this.closedLeadIds(
      this.prisma,
      user,
      rows.map((row) => row.leadId),
    );
    return {
      rows: rows.map((row) =>
        toLogisticsOrderResponse(row, user.role, day, closed.has(row.leadId)),
      ),
      total,
    };
  }

  /**
   * How many orders the caller can see under the list's own filters and scope, its status filter
   * included: per status, and per country, city and area (the order's State — the Area filter's
   * field). One grouped query feeds all four, so each breakdown adds up to the same total as the
   * list. Every status is present, so a zero is a count rather than a missing key. The business
   * day the delivery buckets used comes back with the counts, so a screen can say which day
   * "today" is without reading its own clock.
   */
  async summary(
    filters: LogisticsOrderFiltersDto,
  ): Promise<LogisticsOrderSummaryResponse> {
    const user = await this.currentUser.resolve();
    const day = this.businessDay();
    const groups = await this.prisma.logisticsOrder.groupBy({
      by: ['status', 'country', 'city', 'state'],
      where: orderWhere(user, filters, day),
      _count: { _all: true },
    });

    const counts = statusCounts();
    const countries = new Map<string | null, number>();
    const cities = new Map<string | null, number>();
    const states = new Map<string | null, number>();
    const add = (
      totals: Map<string | null, number>,
      value: string | null,
      count: number,
    ) =>
      totals.set(recorded(value), (totals.get(recorded(value)) ?? 0) + count);
    for (const group of groups) {
      const count = group._count._all;
      counts[group.status] += count;
      add(countries, group.country, count);
      add(cities, group.city, count);
      add(states, group.state, count);
    }
    return {
      counts,
      total: groups.reduce((sum, group) => sum + group._count._all, 0),
      countries: regionCounts(countries),
      cities: regionCounts(cities),
      states: regionCounts(states),
      businessDay: day,
    };
  }

  /**
   * The delivery schedule: the caller's orders under every filter of the screen except the
   * delivery date's own (its buckets and its day), so choosing one day never hides the others —
   * counted per bucket, and per day for the `DELIVERY_SCHEDULE_DAYS` days from today, every day
   * present. One grouped query over the orders some bucket holds (a past delivery with an outcome
   * is in none), sorted by `deliveryBucketOf`, the filter's own rules, so each count is the list's
   * total for that bucket or that day.
   */
  async deliverySchedule(
    filters: LogisticsOrderFiltersDto,
  ): Promise<LogisticsDeliveryScheduleResponse> {
    const user = await this.currentUser.resolve();
    const day = this.businessDay();
    const others = { ...filters, delivery: undefined, deliveryOn: undefined };
    const groups = await this.prisma.logisticsOrder.groupBy({
      by: ['deliveryDate', 'status'],
      where: {
        AND: [
          orderWhere(user, others, day),
          deliveryBucketWhere(DELIVERY_BUCKETS, day),
        ],
      },
      _count: { _all: true },
    });

    const buckets = Object.fromEntries(
      DELIVERY_BUCKETS.map((bucket) => [bucket, 0]),
    ) as Record<DeliveryBucket, number>;
    const days = Array.from({ length: DELIVERY_SCHEDULE_DAYS }, (_, index) => ({
      date: addDays(day.today, index),
      total: 0,
      counts: statusCounts(),
    }));
    for (const group of groups) {
      const count = group._count._all;
      const date = group.deliveryDate && fromDbDate(group.deliveryDate);
      const bucket = deliveryBucketOf(date, group.status, day);
      if (bucket) buckets[bucket] += count;
      const slot = days.find((each) => each.date === date);
      if (slot) {
        slot.total += count;
        slot.counts[group.status] += count;
      }
    }
    return { businessDay: day, buckets, days };
  }

  /**
   * The country, city, state and courier values, and the sales executives, in the caller's
   * scope — every order they may see, whatever the filters in force, so choosing one value never
   * hides the others. A value only orders outside the scope hold is never offered. The sales
   * executives are the users those orders' leads are assigned to now; a sales agent is offered
   * only themselves, as the Leads list's own options never name a co-assignee to an agent.
   */
  async filterOptions(): Promise<LogisticsOrderFilterOptions> {
    const user = await this.currentUser.resolve();
    const scope = logisticsOrderScopeWhere(user);
    const [groups, assignees] = await Promise.all([
      this.prisma.logisticsOrder.groupBy({
        by: ['country', 'city', 'state', 'courier'],
        where: scope,
      }),
      this.prisma.user.findMany({
        where: {
          ...(user.role === UserRole.SALES_AGENT ? { id: user.id } : {}),
          assignments: { some: { lead: { logisticsOrder: { is: scope } } } },
        },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      countries: distinctValues(groups.map((group) => group.country)),
      cities: distinctValues(groups.map((group) => group.city)),
      states: distinctValues(groups.map((group) => group.state)),
      couriers: distinctValues(groups.map((group) => group.courier)),
      assignees,
    };
  }

  /** One order, through the caller's scope: an order they may not see is a 404. */
  async get(id: string): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    const order = await this.prisma.logisticsOrder.findFirst({
      where: { AND: [logisticsOrderScopeWhere(user), { id }] },
      select: LOGISTICS_ORDER_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found.');
    const closed = await this.closedLeadIds(this.prisma, user, [order.leadId]);
    return toLogisticsOrderResponse(
      order,
      user.role,
      this.businessDay(),
      closed.has(order.leadId),
    );
  }

  /**
   * QC passes the order: INITIAL → QC_VERIFIED. The lead is untouched; the remark is optional
   * (Q4).
   *
   * The remark is recorded on the event as well as on the order, for the reason described on
   * `qcReject`: the column holds only the latest QC note, the log holds every one of them.
   */
  async qcVerify(
    id: string,
    dto: QcDecisionDto,
  ): Promise<LogisticsOrderResponse> {
    return this.run(
      id,
      'QC_VERIFY',
      (now) => ({ qcDecidedAt: now, qcRemarks: dto.remarks ?? null }),
      { remarks: dto.remarks ?? null },
    );
  }

  /**
   * QC rejects the order: INITIAL → QC_REJECTED, and the lead moves to `QC NOT APPROVED` in
   * the same transaction (CD-1). Both changes commit together or neither does, so a rejected
   * order can never sit behind a lead that still reads WON. The reason is mandatory (Q4); the
   * DTO has already refused a blank one.
   *
   * The reason is written twice on purpose: `qcRemarks` on the order is QC's latest note, and
   * the audit event is append-only, so the reason this rejection gave stays readable however
   * many times the order goes round afterwards.
   */
  async qcReject(
    id: string,
    dto: QcRejectDto,
  ): Promise<LogisticsOrderResponse> {
    return this.runWithLead(
      id,
      'QC_REJECT',
      (now) => ({ qcDecidedAt: now, qcRemarks: dto.remarks }),
      QC_REJECTED_LEAD_STATUS,
      'logistics.qc',
      { remarks: dto.remarks },
    );
  }

  /**
   * The rejected order goes back to QC: QC_REJECTED → INITIAL, and the lead returns to WON with
   * it (CD-2, Q2). The same order, never a second one — the conversion hook in the lead core
   * sees the lead become WON again and, because `lead_id` is unique, keeps the order it has.
   *
   * Taken by the Sales Manager after Sales corrected the lead (Q1). It changes nothing on the
   * order but its status: not QC's remarks, which stay the reason QC rejected — Sales may not
   * edit QC data — and not the customer and order data. Q2 says QC "continues reviewing the
   * original snapshot", which is what the order holds; nothing here copies the lead's
   * corrections onto the order. Whether it should is open client question Q10 — this method is
   * where the answer lands. The resubmitter's note goes on the event only.
   */
  async resubmit(
    id: string,
    dto: QcDecisionDto,
  ): Promise<LogisticsOrderResponse> {
    return this.runWithLead(
      id,
      'RESUBMIT',
      () => ({}),
      CONVERTED_STATUS,
      'logistics.resubmit',
      { remarks: dto.remarks ?? null },
    );
  }

  /**
   * Ships it: QC_VERIFIED → DISPATCHED. The DTO already refused a missing AWB; the AWB must
   * also be unique across orders (Q9).
   *
   * The AWB and courier go on the event as well as the order, so the journey says what was
   * shipped and how without a second read — the event is the record the client asked for.
   */
  async dispatch(
    id: string,
    dto: DispatchOrderDto,
  ): Promise<LogisticsOrderResponse> {
    const awbNumber = dto.awbNumber.trim();
    if (awbNumber === '') {
      throw new ConflictException(
        'An AWB / tracking number is required before dispatch.',
      );
    }
    const courier = dto.courier?.trim() || null;
    return withAwbClash(() =>
      this.run(
        id,
        'DISPATCH',
        (now) => ({ awbNumber, courier, dispatchedAt: now }),
        { awbNumber, courier },
        (tx) => assertAwbFree(tx, awbNumber, id),
      ),
    );
  }

  /**
   * DISPATCHED → DELIVERED. Terminal. The order enters Accounts in the same transaction (`move`,
   * specification §4 step 11).
   */
  async deliver(id: string): Promise<LogisticsOrderResponse> {
    return this.run(id, 'DELIVER', (now) => ({ deliveredAt: now }));
  }

  /**
   * DISPATCHED or RTO → CANCELLED (CD-3, Q6). Cancelled is terminal (Q8). The reason is
   * mandatory (Q8) and recorded on the order and the event.
   */
  async cancel(
    id: string,
    dto: OrderReasonDto,
  ): Promise<LogisticsOrderResponse> {
    return this.run(
      id,
      'CANCEL',
      (now) => ({ cancelledAt: now, cancelReason: dto.reason }),
      { reason: dto.reason },
    );
  }

  /**
   * DISPATCHED → RTO, the returned-to-origin outcome (CD-4). The reason is mandatory (Q7). RTO
   * leads only to CANCELLED (Q6), and an RTO order never enters Accounts (Q7): nothing here
   * creates any record beside the order's own update and its event.
   */
  async rto(id: string, dto: OrderReasonDto): Promise<LogisticsOrderResponse> {
    return this.run(
      id,
      'RTO',
      (now) => ({ rtoAt: now, rtoReason: dto.reason }),
      { reason: dto.reason },
    );
  }

  /**
   * The Logistics Manager corrects a QC-verified order's own data (Q5). The order stays
   * QC_VERIFIED — it does not go back to QC — and the lead is not touched: this is the order's
   * copy. Only fields whose value actually changes are written, and they are audited before and
   * after; an edit that changes nothing writes nothing. The delivery date (ADR-0094) is one of
   * these fields, compared and audited as its `YYYY-MM-DD` day; setting it never moves the status.
   */
  async edit(
    id: string,
    dto: UpdateLogisticsOrderDto,
  ): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    return this.prisma.$transaction(async (tx) => {
      const order = await this.lockForEdit(tx, id, user, 'EDIT');

      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      for (const field of EDITABLE_ORDER_FIELDS) {
        const next = dto[field];
        if (next === undefined) continue;
        const was =
          field === 'deliveryDate'
            ? order.deliveryDate && fromDbDate(order.deliveryDate)
            : (order[field]?.toString() ?? null);
        const now =
          next === null || !DECIMAL_FIELDS.has(field)
            ? next
            : new Prisma.Decimal(next).toString();
        if (was !== now) {
          before[field] = was;
          after[field] = now;
        }
      }

      if (Object.keys(after).length > 0) {
        const { deliveryDate, ...fields } = after;
        await tx.logisticsOrder.update({
          where: { id },
          data:
            deliveryDate === undefined
              ? fields
              : {
                  ...fields,
                  deliveryDate: deliveryDate && toDbDate(deliveryDate),
                },
        });
        await recordAuditEvents(tx, [
          {
            entityType: 'LOGISTICS_ORDER',
            entityId: id,
            leadId: order.leadId,
            action: 'UPDATED',
            actor: userActor(user),
            source: 'logistics.edit',
            before,
            after,
          },
        ]);
      }
      return this.loadFull(tx, id, user);
    });
  }

  /**
   * The Logistics Manager corrects the AWB after dispatch (Q9); the new one must be unique too.
   * The old value is kept on the event — the order holds the current AWB, the log every one it
   * ever had. The model has no correction-reason field and none was asked for, so none is
   * required.
   */
  async correctAwb(
    id: string,
    dto: CorrectAwbDto,
  ): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    return withAwbClash(() =>
      this.prisma.$transaction(async (tx) => {
        const order = await this.lockForEdit(tx, id, user, 'CORRECT_AWB');
        if (order.awbNumber !== dto.awbNumber) {
          await assertAwbFree(tx, dto.awbNumber, id);
          await tx.logisticsOrder.update({
            where: { id },
            data: { awbNumber: dto.awbNumber },
          });
          await recordAuditEvents(tx, [
            {
              entityType: 'LOGISTICS_ORDER',
              entityId: id,
              leadId: order.leadId,
              action: 'AWB_CORRECTED',
              actor: userActor(user),
              source: 'logistics.awb',
              before: { awbNumber: order.awbNumber },
              after: { awbNumber: dto.awbNumber },
            },
          ]);
        }
        return this.loadFull(tx, id, user);
      }),
    );
  }

  /**
   * Sales sets or changes the delivery date the customer asked for, before QC verifies the order
   * (Phase 2D, ADR-0094 P1–P4): the order's own sales agent or their team's manager, through the
   * scope every read uses, so anyone else's order is a 404, and only while it is QC Pending or QC
   * Rejected, otherwise a 409. The row is locked first, as for the Manager's edit, so a QC
   * verification racing this request either waits for it or commits first and turns it into a
   * 409: Sales never changes the date of an order QC has verified. A lead in a pipeline closed to
   * the caller is theirs to view, not to change (ADR-0093 B2): a 403.
   *
   * A day before the business day's today is refused (P4); today is allowed, and the date can't be
   * cleared (the DTO refuses null): every order must have one (client, 2026-10-17). The Manager's
   * edit stays the way to correct a past date once the order is verified. Resending the
   * date the order already has writes nothing. A change is the order's `UPDATED` event with its
   * before and after days, as the Manager's edit records one. The status never moves and the lead
   * is not touched.
   */
  async setDeliveryDate(
    id: string,
    dto: SetDeliveryDateDto,
  ): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    return this.prisma.$transaction(async (tx) => {
      const order = await this.lockForEdit(tx, id, user, 'SET_DELIVERY_DATE');
      const before = order.deliveryDate && fromDbDate(order.deliveryDate);
      const after = dto.deliveryDate;
      if (before !== after) {
        assertRequestedDeliveryDay(after, this.businessDay());
        await tx.logisticsOrder.update({
          where: { id },
          data: { deliveryDate: toDbDate(after) },
        });
        await recordAuditEvents(tx, [
          {
            entityType: 'LOGISTICS_ORDER',
            entityId: id,
            leadId: order.leadId,
            action: 'UPDATED',
            actor: userActor(user),
            source: 'logistics.delivery_date',
            before: { deliveryDate: before },
            after: { deliveryDate: after },
          },
        ]);
      }
      return this.loadFull(tx, id, user);
    });
  }

  /**
   * The Logistics team corrects the delivery date of an order QC has verified, before or after
   * dispatch (client, 2026-10-17), saying why. The row is locked first, as for every edit, and
   * read through the caller's scope; any other status is a 409. The day must be today or later
   * in the business timezone — the same rule as Sales' date — and the date can't be cleared.
   * Resending the day the order already has writes and records nothing. A change is the order's
   * `UPDATED` event with its before and after days and the reason, source
   * `logistics.delivery_date_correction`, so the Journey tells it apart from Sales' date and the
   * Manager's edit. The status never moves and the lead is not touched.
   */
  async correctDeliveryDate(
    id: string,
    dto: CorrectDeliveryDateDto,
  ): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    return this.prisma.$transaction(async (tx) => {
      const order = await this.lockForEdit(
        tx,
        id,
        user,
        'CORRECT_DELIVERY_DATE',
      );
      const before = order.deliveryDate && fromDbDate(order.deliveryDate);
      const after = dto.deliveryDate;
      if (before !== after) {
        assertRequestedDeliveryDay(after, this.businessDay());
        await tx.logisticsOrder.update({
          where: { id },
          data: { deliveryDate: toDbDate(after) },
        });
        await recordAuditEvents(tx, [
          {
            entityType: 'LOGISTICS_ORDER',
            entityId: id,
            leadId: order.leadId,
            action: 'UPDATED',
            actor: userActor(user),
            source: 'logistics.delivery_date_correction',
            before: { deliveryDate: before },
            after: { deliveryDate: after },
            metadata: { reason: dto.reason },
          },
        ]);
      }
      return this.loadFull(tx, id, user);
    });
  }

  /** A transition that touches only the order. `check` runs inside its transaction first. */
  private async run(
    id: string,
    action: LogisticsAction,
    fields: (now: Date) => Prisma.LogisticsOrderUpdateManyMutationInput,
    details?: Prisma.InputJsonObject,
    check?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    return this.prisma.$transaction(async (tx) => {
      const order = await this.loadState(tx, id, user);
      assertDatedFor(action, order);
      await check?.(tx);
      await this.move(tx, order, action, fields, user, details);
      return this.loadFull(tx, id, user);
    });
  }

  /** A transition that also writes the lead's status back, atomically. */
  private async runWithLead(
    id: string,
    action: LogisticsAction,
    fields: (now: Date) => Prisma.LogisticsOrderUpdateManyMutationInput,
    leadStatus: string,
    source: string,
    details?: Prisma.InputJsonObject,
  ): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    return this.prisma.$transaction(async (tx) => {
      const order = await this.loadState(tx, id, user);
      await applyLeadChanges(
        tx,
        [order.leadId],
        {
          actor: userActor(user),
          source,
          // This call only ever touches this one lead and this one order, so naming the
          // order on its events is exact — never a shared bag of metadata (ADR-0085 B14).
          metadata: { orderId: order.id },
        },
        async (inner) => {
          await this.move(inner, order, action, fields, user, details);
          await assertLeadStage(inner, order.leadId, leadStatus);
          await inner.lead.update({
            where: { id: order.leadId },
            // The capture rule: any status other than LOST clears the lost reason, so a lead
            // that was LOST before it was won does not carry a stale one into Logistics.
            data: { status: leadStatus, lostReason: null },
          });
        },
        { logisticsWriteBack: true },
      );
      return this.loadFull(tx, id, user);
    });
  }

  /**
   * The conditional move plus its audit event. The move is decided on the status just read —
   * and that status is the event's "before" — so the update matches that exact status: an
   * illegal move, or one overtaken by a concurrent move (an RTO landing while a cancel was in
   * flight), changes no row and is a 409 carrying the status the order is actually in, read
   * back after the attempt. It is never written over a status other than the one it records.
   */
  private async move(
    tx: Prisma.TransactionClient,
    order: { id: string; leadId: string; status: LogisticsStatus },
    action: LogisticsAction,
    fields: (now: Date) => Prisma.LogisticsOrderUpdateManyMutationInput,
    user: CurrentUser,
    details?: Prisma.InputJsonObject,
  ): Promise<void> {
    const transition = LOGISTICS_TRANSITIONS[action];
    const now = new Date();

    const { count } = transition.from.includes(order.status)
      ? await tx.logisticsOrder.updateMany({
          where: { id: order.id, status: order.status },
          data: {
            status: transition.to,
            statusChangedAt: now,
            ...fields(now),
          },
        })
      : { count: 0 };
    if (count === 0) {
      const current = await this.loadState(tx, order.id, user);
      throw new ConflictException(
        `This order is ${current.status}; it cannot be moved to ${transition.to}.`,
      );
    }

    await recordAuditEvents(tx, [
      {
        entityType: 'LOGISTICS_ORDER',
        entityId: order.id,
        leadId: order.leadId,
        action: transition.action,
        actor: userActor(user),
        source: `logistics.${action.toLowerCase()}`,
        before: { status: order.status },
        after: { status: transition.to },
        ...(details === undefined ? {} : { metadata: details }),
      },
    ]);

    // A delivered order enters Accounts (specification §4 step 11), here, so every path that
    // reaches DELIVERED opens its record in the same transaction as the move itself.
    if (transition.to === LogisticsStatus.DELIVERED) {
      await openAccountsRecord(
        tx,
        order,
        userActor(user),
        `logistics.${action.toLowerCase()}`,
      );
    }
  }

  /**
   * Just what a transition needs to decide and to audit, read through the caller's scope: an
   * order they may not see is a 404, whatever the route admitted. That is what keeps a Sales
   * Manager's resubmit to their own team's orders (CLAUDE.md §8).
   */
  private async loadState(
    tx: Prisma.TransactionClient,
    id: string,
    user: CurrentUser,
  ): Promise<{
    id: string;
    leadId: string;
    status: LogisticsStatus;
    deliveryDate: Date | null;
  }> {
    const order = await tx.logisticsOrder.findFirst({
      where: { AND: [logisticsOrderScopeWhere(user), { id }] },
      select: { id: true, leadId: true, status: true, deliveryDate: true },
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  /**
   * An edit's starting point: the row locked for the rest of the transaction, so the before
   * values recorded are the ones overwritten and a concurrent move waits for this one; read
   * through the caller's scope; and in a status the edit may be made in, or a 409 naming the
   * status it is in. Sales' date is also a change to the lead's order, so a lead in a pipeline
   * closed to the caller refuses it with a 403, whatever the order's status.
   */
  private async lockForEdit(
    tx: Prisma.TransactionClient,
    id: string,
    user: CurrentUser,
    edit: OrderEdit,
  ): Promise<LogisticsOrderRow> {
    await tx.$queryRaw`SELECT id FROM logistics_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.logisticsOrder.findFirst({
      where: { AND: [logisticsOrderScopeWhere(user), { id }] },
      select: LOGISTICS_ORDER_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (edit === 'SET_DELIVERY_DATE') {
      assertMayChangeLead(
        user,
        await tx.lead.findUniqueOrThrow({
          where: { id: order.leadId },
          select: { pipeline: true },
        }),
      );
    }
    if (!ORDER_EDIT_STATUSES[edit].includes(order.status)) {
      throw new ConflictException(
        `This order is ${order.status}; ${EDIT_REFUSAL[edit]}.`,
      );
    }
    return order;
  }

  /**
   * The order as the API returns it, read back after the move so it reflects the write — and so
   * its `allowedActions` are those of the status it has just reached.
   */
  private async loadFull(
    tx: Prisma.TransactionClient,
    id: string,
    user: CurrentUser,
  ): Promise<LogisticsOrderResponse> {
    const order = await tx.logisticsOrder.findUnique({
      where: { id },
      select: LOGISTICS_ORDER_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found.');
    const closed = await this.closedLeadIds(tx, user, [order.leadId]);
    return toLogisticsOrderResponse(
      order,
      user.role,
      this.businessDay(),
      closed.has(order.leadId),
    );
  }

  /**
   * Which of `leadIds` sit in a pipeline closed to the caller (ADR-0093 B2). A sales agent sees
   * the order of a lead assigned to them there but may not change it, so its date action is not
   * offered. No query at all for a caller with every pipeline open — the admin and the Logistics
   * roles always are.
   */
  private async closedLeadIds(
    client: Pick<Prisma.TransactionClient, 'lead'>,
    user: CurrentUser,
    leadIds: string[],
  ): Promise<ReadonlySet<string>> {
    if (!user.deniedPipelines?.length || leadIds.length === 0) {
      return new Set();
    }
    const rows = await client.lead.findMany({
      where: {
        id: { in: leadIds },
        pipeline: { in: [...user.deniedPipelines] },
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
}
