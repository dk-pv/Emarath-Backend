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
  QC_REJECTED_LEAD_STATUS,
} from './logistics-status';
import {
  DispatchOrderDto,
  ListLogisticsOrdersDto,
  LOGISTICS_ORDER_SELECT,
  LogisticsOrderListResponse,
  LogisticsOrderResponse,
  OrderReasonDto,
  QcDecisionDto,
  toLogisticsOrderResponse,
} from './dto/logistics-order.dto';

/** Newest first; `id` breaks ties so a row never repeats across pages. */
const ORDER_BY: Prisma.LogisticsOrderOrderByWithRelationInput[] = [
  { convertedAt: 'desc' },
  { id: 'asc' },
];

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
 * The Logistics order lifecycle (ADR-0085, client clarification of 2026-09-23).
 *
 * Orders are created by conversion, never here: this service only moves an existing one along
 * the state machine in `logistics-status.ts`. Every move is a conditional update against the
 * statuses that table allows, so an illegal or stale transition changes nothing and comes back
 * as a 409 naming the status the order is really in — a caller cannot reach a state the table
 * does not describe, whatever it sends.
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

  /** A scoped page of orders: Logistics sees every one, Sales only their own leads'. */
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
   * QC passes the order: INITIAL → QC_VERIFIED. The lead is untouched.
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
   * order can never sit behind a lead that still reads WON.
   *
   * The reason is written twice on purpose. `qcRemarks` on the order is the **latest** QC note
   * and a later resubmit overwrites it; the audit event is append-only, so the reason this
   * rejection gave stays readable however many times the order goes round afterwards. Without
   * the event copy, resubmitting with no note erased why QC rejected in the first place.
   */
  async qcReject(
    id: string,
    dto: QcDecisionDto,
  ): Promise<LogisticsOrderResponse> {
    return this.runWithLead(
      id,
      'QC_REJECT',
      (now) => ({ qcDecidedAt: now, qcRemarks: dto.remarks ?? null }),
      QC_REJECTED_LEAD_STATUS,
      'logistics.qc',
      { remarks: dto.remarks ?? null },
    );
  }

  /**
   * The corrected order goes back for checking: QC_REJECTED → INITIAL, and the lead returns to
   * WON with it (CD-2). This is the controlled re-entry — the same order, never a second one,
   * and the only way a rejected order moves at all. The conversion hook in the lead core sees
   * the lead become WON again and, because `lead_id` is unique, keeps the order it already has.
   */
  async resubmit(
    id: string,
    dto: QcDecisionDto,
  ): Promise<LogisticsOrderResponse> {
    return this.runWithLead(
      id,
      'RESUBMIT',
      () => ({ qcRemarks: dto.remarks ?? null }),
      CONVERTED_STATUS,
      'logistics.resubmit',
      { remarks: dto.remarks ?? null },
    );
  }

  /**
   * Ships it: QC_VERIFIED → DISPATCHED. The DTO already refused a missing or blank AWB.
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
    );
  }

  /** DISPATCHED → DELIVERED. Terminal: Accounts attaches here in a later phase. */
  async deliver(id: string): Promise<LogisticsOrderResponse> {
    return this.run(id, 'DELIVER', (now) => ({ deliveredAt: now }));
  }

  /**
   * DISPATCHED → CANCELLED. Cancellation before dispatch is refused by the table (CD-3). The
   * reason is recorded on the event as given — still optional, null when none was given.
   */
  async cancel(
    id: string,
    dto: OrderReasonDto,
  ): Promise<LogisticsOrderResponse> {
    const reason = dto.reason ?? null;
    return this.run(
      id,
      'CANCEL',
      (now) => ({ cancelledAt: now, cancelReason: reason }),
      { reason },
    );
  }

  /**
   * DISPATCHED → RTO, the returned-to-origin outcome (CD-4). Terminal for this phase. The
   * reason is recorded on the event as given — still optional, null when none was given.
   */
  async rto(id: string, dto: OrderReasonDto): Promise<LogisticsOrderResponse> {
    const reason = dto.reason ?? null;
    return this.run(id, 'RTO', (now) => ({ rtoAt: now, rtoReason: reason }), {
      reason,
    });
  }

  /** A transition that touches only the order. */
  private async run(
    id: string,
    action: LogisticsAction,
    fields: (now: Date) => Prisma.LogisticsOrderUpdateManyMutationInput,
    details?: Prisma.InputJsonObject,
  ): Promise<LogisticsOrderResponse> {
    const user = await this.currentUser.resolve();
    return this.prisma.$transaction(async (tx) => {
      const order = await this.loadState(tx, id);
      await this.move(tx, order, action, fields, user, details);
      return this.loadFull(tx, id, user.role);
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
      const order = await this.loadState(tx, id);
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
   * The conditional move plus its audit event. `updateMany` with the allowed source statuses
   * is what makes an illegal or concurrent transition a no-op: zero rows changed is a 409
   * carrying the status the order is actually in, read back after the attempt.
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

    const { count } = await tx.logisticsOrder.updateMany({
      where: { id: order.id, status: { in: transition.from } },
      data: {
        status: transition.to,
        statusChangedAt: now,
        ...fields(now),
      },
    });
    if (count === 0) {
      const current = await this.loadState(tx, order.id);
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

  /** Just what a transition needs to decide and to audit. */
  private async loadState(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ id: string; leadId: string; status: LogisticsStatus }> {
    const order = await tx.logisticsOrder.findUnique({
      where: { id },
      select: { id: true, leadId: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found.');
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
