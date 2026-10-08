import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LogisticsStatus, Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { recordAuditEvents, userActor } from '../audit/audit-events';
import { applyLeadChanges } from '../leads/lead-audit';
import { escapeLike } from '../leads/lead-search';
import { CONVERTED_STATUS } from '../reports/converted-leads-where';
import { logisticsOrderScopeWhere } from './logistics-roles';
import {
  LOGISTICS_TRANSITIONS,
  LogisticsAction,
  ORDER_EDIT_STATUSES,
  OrderEdit,
  QC_REJECTED_LEAD_STATUS,
} from './logistics-status';
import {
  CorrectAwbDto,
  DispatchOrderDto,
  EDITABLE_ORDER_FIELDS,
  ListLogisticsOrdersDto,
  LOGISTICS_ORDER_SELECT,
  LogisticsOrderListResponse,
  LogisticsOrderResponse,
  LogisticsOrderRow,
  OrderReasonDto,
  QcDecisionDto,
  QcRejectDto,
  toLogisticsOrderResponse,
  UpdateLogisticsOrderDto,
} from './dto/logistics-order.dto';

/** Newest first; `id` breaks ties so a row never repeats across pages. */
const ORDER_BY: Prisma.LogisticsOrderOrderByWithRelationInput[] = [
  { convertedAt: 'desc' },
  { id: 'asc' },
];

/** The editable fields stored as decimals, compared by value rather than by spelling. */
const DECIMAL_FIELDS: ReadonlySet<string> = new Set([
  'productQty',
  'product2Qty',
  'orderValue',
]);

/**
 * Free text over what the queue shows — the order number, the customer's name and phone, and
 * the AWB — matched as the other lists match: case-insensitive, with `%`/`_` literal. A term
 * that is a number also matches the order number exactly, with or without the `#` it is shown
 * with. It narrows the caller's scope and can never widen it: it is one more AND term.
 */
function orderSearchWhere(
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
 * state machine in `logistics-status.ts`, and makes the Logistics Manager's two corrections (the
 * order's data after QC, the AWB after dispatch). Every move is a conditional update from the
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** A scoped page of orders: Logistics and QC see every one, Sales only their own leads'. */
  async list(
    query: ListLogisticsOrdersDto,
  ): Promise<LogisticsOrderListResponse> {
    const user = await this.currentUser.resolve();
    const where: Prisma.LogisticsOrderWhereInput = {
      AND: [
        logisticsOrderScopeWhere(user),
        query.status ? { status: query.status } : {},
        query.leadId ? { leadId: query.leadId } : {},
        orderSearchWhere(query.search),
      ],
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.logisticsOrder.findMany({
        where,
        select: LOGISTICS_ORDER_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.logisticsOrder.count({ where }),
    ]);

    return {
      rows: rows.map((row) => toLogisticsOrderResponse(row, user.role)),
      total,
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
    return toLogisticsOrderResponse(order, user.role);
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
    return this.run(
      id,
      'DISPATCH',
      (now) => ({ awbNumber, courier, dispatchedAt: now }),
      { awbNumber, courier },
      (tx) => assertAwbFree(tx, awbNumber, id),
    );
  }

  /** DISPATCHED → DELIVERED. Terminal: Accounts attaches here in a later phase. */
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
   * after; an edit that changes nothing writes nothing.
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
        const was = order[field]?.toString() ?? null;
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
        await tx.logisticsOrder.update({ where: { id }, data: after });
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
      return this.loadFull(tx, id, user.role);
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
        return this.loadFull(tx, id, user.role);
      }),
    );
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
    return withAwbClash(() =>
      this.prisma.$transaction(async (tx) => {
        const order = await this.loadState(tx, id, user);
        await check?.(tx);
        await this.move(tx, order, action, fields, user, details);
        return this.loadFull(tx, id, user.role);
      }),
    );
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
          await inner.lead.update({
            where: { id: order.leadId },
            // The capture rule: any status other than LOST clears the lost reason, so a lead
            // that was LOST before it was won does not carry a stale one into Logistics.
            data: { status: leadStatus, lostReason: null },
          });
        },
        { logisticsWriteBack: true },
      );
      return this.loadFull(tx, id, user.role);
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
  ): Promise<{ id: string; leadId: string; status: LogisticsStatus }> {
    const order = await tx.logisticsOrder.findFirst({
      where: { AND: [logisticsOrderScopeWhere(user), { id }] },
      select: { id: true, leadId: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  /**
   * An edit's starting point: the row locked for the rest of the transaction, so the before
   * values recorded are the ones overwritten; read through the caller's scope; and in a status
   * the edit may be made in, or a 409 naming the status it is in.
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
    if (!ORDER_EDIT_STATUSES[edit].includes(order.status)) {
      throw new ConflictException(
        edit === 'EDIT'
          ? `This order is ${order.status}; it can only be edited while QC_VERIFIED.`
          : `This order is ${order.status}; its AWB can only be corrected after dispatch.`,
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
    role: UserRole,
  ): Promise<LogisticsOrderResponse> {
    const order = await tx.logisticsOrder.findUnique({
      where: { id },
      select: LOGISTICS_ORDER_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found.');
    return toLogisticsOrderResponse(order, role);
  }
}
