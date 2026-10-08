import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LogisticsStatus, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LogisticsOrdersService } from './logistics-orders.service';
import {
  LOGISTICS_TRANSITIONS,
  LogisticsAction,
  TERMINAL_STATUSES,
} from './logistics-status';
import {
  CorrectAwbDto,
  EDITABLE_ORDER_FIELDS,
  ListLogisticsOrdersDto,
  OrderReasonDto,
  QcDecisionDto,
  QcRejectDto,
  UpdateLogisticsOrderDto,
} from './dto/logistics-order.dto';

const ORDER = '33333333-3333-3333-3333-333333333333';
const LEAD = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

interface Options {
  status?: LogisticsStatus;
  leadStatus?: string;
  role?: UserRole;
  team?: string | null;
  /** False makes the scoped read find nothing, as for an order outside the caller's scope. */
  inScope?: boolean;
  /** Another order already holding an AWB, as the uniqueness check would find it. */
  awbHolder?: { awbNumber: string; orderNumber: number };
  awbNumber?: string | null;
  /** A concurrent move that commits between the service's read and its write. */
  racedTo?: LogisticsStatus;
}

/**
 * A stateful double: the order and its lead are objects the writes mutate, so a transition's
 * conditional update behaves as the database would — it changes the row only when the current
 * status is still the exact status the service read and matched on.
 */
function makeService(options: Options = {}) {
  const order = {
    id: ORDER,
    leadId: LEAD,
    status: options.status ?? LogisticsStatus.INITIAL,
    orderNumber: 1001,
    statusChangedAt: new Date('2026-09-23T08:00:00.000Z'),
    convertedAt: new Date('2026-09-23T08:00:00.000Z'),
    convertedById: USER,
    customerName: 'Acme Trading',
    primaryPhone: '971500000000',
    secondaryPhone: null as string | null,
    email: null as string | null,
    country: null as string | null,
    state: null as string | null,
    city: 'Dubai' as string | null,
    street: null as string | null,
    nationalCode: null as string | null,
    product: 'Water filter' as string | null,
    productQty: new Prisma.Decimal('2') as Prisma.Decimal | null,
    product2: null as string | null,
    product2Qty: null as Prisma.Decimal | null,
    orderValue: new Prisma.Decimal('250') as Prisma.Decimal | null,
    paymentMethod: null as string | null,
    qcDecidedAt: null as Date | null,
    qcRemarks: null as string | null,
    awbNumber: options.awbNumber ?? null,
    courier: null as string | null,
    dispatchedAt: null as Date | null,
    deliveredAt: null as Date | null,
    cancelledAt: null as Date | null,
    cancelReason: null as string | null,
    rtoAt: null as Date | null,
    rtoReason: null as string | null,
  };
  const lead = { status: options.leadStatus ?? 'WON' };

  const orderUpdateMany = jest.fn(
    (args: {
      where: { id: string; status: LogisticsStatus };
      data: Record<string, unknown>;
    }) => {
      if (options.racedTo) order.status = options.racedTo;
      if (args.where.status !== order.status) {
        return Promise.resolve({ count: 0 });
      }
      Object.assign(order, args.data);
      return Promise.resolve({ count: 1 });
    },
  );
  const orderUpdate = jest.fn((args: { data: Record<string, unknown> }) => {
    Object.assign(order, args.data);
    return Promise.resolve({ id: ORDER });
  });
  const orderFindUnique = jest.fn((args: { where: { id: string } }) =>
    Promise.resolve(args.where.id === ORDER ? { ...order } : null),
  );
  // Two reads share this method: the uniqueness check asks by AWB, every other read asks for
  // one order through the caller's scope.
  const orderFindFirst = jest.fn(
    (args: { where: { awbNumber?: string; AND?: unknown[] } }) => {
      if (args.where.awbNumber !== undefined) {
        return Promise.resolve(
          options.awbHolder?.awbNumber === args.where.awbNumber
            ? { orderNumber: options.awbHolder.orderNumber }
            : null,
        );
      }
      const wanted = JSON.stringify(args.where).includes(`"id":"${ORDER}"`);
      return Promise.resolve(
        wanted && options.inScope !== false ? { ...order } : null,
      );
    },
  );
  // The lead's audit row, built from the lead as it stands, so the change core's before/after
  // reads differ exactly when the write-back moved it.
  const leadFindMany = jest.fn(() =>
    Promise.resolve([
      {
        id: LEAD,
        name: 'Acme Trading',
        firstName: null,
        primaryPhone: '971500000000',
        secondaryPhone: null,
        email: null,
        language: null,
        country: null,
        source: null,
        status: lead.status,
        lostReason: null,
        pipeline: 'Lead Pipeline',
        product: null,
        productQty: null,
        product2: null,
        product2Qty: null,
        bookingDate: null,
        category: null,
        actualAmount: null,
        forecastedAmount: null,
        paymentMethod: null,
        state: null,
        street: null,
        city: null,
        nationalCode: null,
        callStatus: null,
        callAttempts: 0,
        whatsappAttempts: 0,
        deletedAt: null,
        assignments: [],
        tags: [],
        customFieldValues: [],
        complaints: [],
      },
    ]),
  );
  const leadUpdate = jest.fn((args: { data: { status: string } }) => {
    lead.status = args.data.status;
    return Promise.resolve({ id: LEAD });
  });
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  // The lead already has this order, so the guard sees it and the conversion keeps it.
  const orderFindMany = jest
    .fn()
    .mockResolvedValue([{ id: ORDER, leadId: LEAD }]);
  const createManyAndReturn = jest.fn().mockResolvedValue([]);
  const queryRaw = jest.fn().mockResolvedValue([]);

  const tx = {
    $queryRaw: queryRaw,
    logisticsOrder: {
      findUnique: orderFindUnique,
      findFirst: orderFindFirst,
      updateMany: orderUpdateMany,
      update: orderUpdate,
      findMany: orderFindMany,
      createManyAndReturn,
    },
    lead: { findMany: leadFindMany, update: leadUpdate },
    auditEvent: { createMany: auditCreateMany },
  };
  const listFindMany = jest.fn().mockResolvedValue([{ ...order }]);
  const listCount = jest.fn().mockResolvedValue(1);
  const findFirst = jest.fn().mockResolvedValue({ ...order });
  const prisma = {
    $transaction: jest.fn(
      (arg: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(tx),
    ),
    logisticsOrder: {
      findMany: listFindMany,
      count: listCount,
      findFirst,
    },
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({
      id: USER,
      role: options.role ?? UserRole.LOGISTICS_MANAGER,
      team: options.team ?? null,
    }),
  } as unknown as CurrentUserService;

  return {
    service: new LogisticsOrdersService(prisma, currentUser),
    order,
    lead,
    orderUpdateMany,
    orderUpdate,
    orderFindFirst,
    leadUpdate,
    auditCreateMany,
    createManyAndReturn,
    queryRaw,
    listFindMany,
    findFirst,
  };
}

/** The audit rows a call wrote, flattened across its `recordAuditEvents` calls. */
function events(auditCreateMany: jest.Mock): Record<string, unknown>[] {
  return (
    auditCreateMany.mock.calls as [{ data: Record<string, unknown>[] }][]
  ).flatMap((call) => call[0].data);
}

const query = (
  over: Partial<ListLogisticsOrdersDto> = {},
): ListLogisticsOrdersDto => ({ page: 1, size: 50, ...over });

const reason = (text: string): OrderReasonDto => ({ reason: text });

describe('LogisticsOrdersService — QC', () => {
  it('verifies an order waiting for QC, and leaves the lead alone', async () => {
    const { service, order, leadUpdate, auditCreateMany } = makeService({
      role: UserRole.QC,
    });

    const result = await service.qcVerify(ORDER, { remarks: 'Looks right' });

    expect(result.status).toBe(LogisticsStatus.QC_VERIFIED);
    expect(order.qcDecidedAt).toBeInstanceOf(Date);
    expect(order.qcRemarks).toBe('Looks right');
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(events(auditCreateMany)).toMatchObject([
      {
        entityType: 'LOGISTICS_ORDER',
        entityId: ORDER,
        leadId: LEAD,
        action: 'QC_VERIFIED',
        actorId: USER,
        before: { status: 'INITIAL' },
        after: { status: 'QC_VERIFIED' },
        metadata: { remarks: 'Looks right' },
      },
    ]);
  });

  it('verifies without a remark — approval remarks are optional (Q4)', async () => {
    const { service, order, auditCreateMany } = makeService({
      role: UserRole.QC,
    });

    await service.qcVerify(ORDER, {});

    expect(order.status).toBe(LogisticsStatus.QC_VERIFIED);
    expect(order.qcRemarks).toBeNull();
    expect(events(auditCreateMany)).toMatchObject([
      { action: 'QC_VERIFIED', metadata: { remarks: null } },
    ]);
  });

  /*
    CD-1: the lead goes to the stage the client already uses, never a new one — and it happens
    in the rejection's own transaction, so an order can never read QC_REJECTED behind a lead
    that still reads WON.
  */
  it('rejects the order and moves the lead to QC NOT APPROVED in one transaction', async () => {
    const { service, order, lead, leadUpdate, auditCreateMany } = makeService({
      role: UserRole.QC,
    });

    const result = await service.qcReject(ORDER, { remarks: 'Wrong address' });

    expect(result.status).toBe(LogisticsStatus.QC_REJECTED);
    expect(lead.status).toBe('QC NOT APPROVED');
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: LEAD },
      data: { status: 'QC NOT APPROVED', lostReason: null },
    });
    expect(order.qcRemarks).toBe('Wrong address');
    // Both halves are audited, the reason with the order's, and the lead's event names the
    // order it came from.
    expect(events(auditCreateMany)).toMatchObject([
      {
        entityType: 'LOGISTICS_ORDER',
        action: 'QC_REJECTED',
        metadata: { remarks: 'Wrong address' },
      },
      {
        entityType: 'LEAD',
        action: 'STATUS_CHANGED',
        source: 'logistics.qc',
        before: { status: 'WON' },
        after: { status: 'QC NOT APPROVED' },
        metadata: { orderId: ORDER },
      },
    ]);
  });

  it('refuses a QC decision on an order that has left QC', async () => {
    const { service, leadUpdate } = makeService({
      role: UserRole.QC,
      status: LogisticsStatus.DISPATCHED,
    });

    await expect(
      service.qcReject(ORDER, { remarks: 'Too late' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('404s an order that does not exist', async () => {
    const { service } = makeService({ role: UserRole.QC });

    await expect(
      service.qcVerify('44444444-4444-4444-4444-444444444444', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/*
  CD-2 and Q2: the corrected order goes back through QC. The same order, never a second one —
  which is why resubmit is a business action rather than an editable status.
*/
describe('LogisticsOrdersService — resubmit', () => {
  const rejected = (over: Options = {}) =>
    makeService({
      status: LogisticsStatus.QC_REJECTED,
      leadStatus: 'QC NOT APPROVED',
      role: UserRole.SALES_MANAGER,
      team: 'Dubai',
      ...over,
    });

  it('returns the rejected order to INITIAL and the lead to WON', async () => {
    const { service, lead, leadUpdate, auditCreateMany } = rejected();

    const result = await service.resubmit(ORDER, { remarks: 'Address fixed' });

    expect(result.status).toBe(LogisticsStatus.INITIAL);
    expect(lead.status).toBe('WON');
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: LEAD },
      data: { status: 'WON', lostReason: null },
    });
    expect(events(auditCreateMany)).toMatchObject([
      {
        entityType: 'LOGISTICS_ORDER',
        action: 'RESUBMITTED',
        actorId: USER,
        metadata: { remarks: 'Address fixed' },
      },
      {
        entityType: 'LEAD',
        action: 'CONVERTED',
        source: 'logistics.resubmit',
        metadata: { orderId: ORDER },
      },
    ]);
  });

  it('creates no second order when the lead becomes WON again', async () => {
    const { service, createManyAndReturn, auditCreateMany } = rejected();

    await service.resubmit(ORDER, {});

    // The insert runs and skips: `lead_id` is unique, so the lead keeps the order it has.
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(
      events(auditCreateMany).filter(
        (event) =>
          event.entityType === 'LOGISTICS_ORDER' && event.action === 'CREATED',
      ),
    ).toEqual([]);
  });

  /*
    Sales may not edit QC data, so the resubmit leaves QC's remarks — the rejection reason — on
    the order; the resubmitter's note goes on the event only.
  */
  it('keeps QC’s rejection reason on the order', async () => {
    const qc = makeService({ role: UserRole.QC });
    await qc.service.qcReject(ORDER, { remarks: 'Wrong delivery address' });
    expect(qc.order.qcRemarks).toBe('Wrong delivery address');

    const { service, order } = rejected();
    order.qcRemarks = 'Wrong delivery address';
    await service.resubmit(ORDER, { remarks: 'Fixed by sales' });

    expect(order.qcRemarks).toBe('Wrong delivery address');
  });

  /*
    Q2: "QC continues reviewing the original snapshot." Pinned as the behaviour that answer
    describes: the resubmit changes the order's status and nothing else, so whatever Sales
    corrected on the lead is not copied onto the order. Whether it should be is an open client
    question; this test is what fails when that is decided.
  */
  it('changes only the status — the order’s customer and order data are left as captured', async () => {
    const { service, order, orderUpdateMany } = rejected();
    const snapshot = { ...order };

    await service.resubmit(ORDER, {});

    const [args] = orderUpdateMany.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(Object.keys(args.data).sort()).toEqual(
      ['status', 'statusChangedAt'].sort(),
    );
    expect(order.customerName).toBe(snapshot.customerName);
    expect(order.city).toBe(snapshot.city);
    expect(order.product).toBe(snapshot.product);
  });

  it('reads the order through the Sales Manager’s own team scope', async () => {
    const { service, orderFindFirst } = rejected();

    await service.resubmit(ORDER, {});

    const [args] = orderFindFirst.mock.calls[0] as [{ where: unknown }];
    expect(JSON.stringify(args.where)).toContain('"team":"Dubai"');
  });

  it('404s an order outside the Sales Manager’s team, and writes nothing', async () => {
    const { service, orderUpdateMany, leadUpdate, auditCreateMany } = rejected({
      inScope: false,
    });

    await expect(service.resubmit(ORDER, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('refuses to resubmit an order QC has not rejected', async () => {
    const { service } = rejected({ status: LogisticsStatus.INITIAL });

    await expect(service.resubmit(ORDER, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('LogisticsOrdersService — dispatch and the AWB', () => {
  it('dispatches a verified order, recording the AWB and the time', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      role: UserRole.LOGISTICS_EXECUTIVE,
    });

    const result = await service.dispatch(ORDER, {
      awbNumber: ' AWB-123 ',
      courier: 'Aramex',
    });

    expect(result.status).toBe(LogisticsStatus.DISPATCHED);
    expect(order.awbNumber).toBe('AWB-123');
    expect(order.courier).toBe('Aramex');
    expect(order.dispatchedAt).toBeInstanceOf(Date);
    expect(events(auditCreateMany)).toMatchObject([
      {
        action: 'DISPATCHED',
        metadata: { awbNumber: 'AWB-123', courier: 'Aramex' },
      },
    ]);
  });

  it('records a dispatch with no courier as exactly that', async () => {
    const { service, auditCreateMany } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
    });

    await service.dispatch(ORDER, { awbNumber: 'AWB-9', courier: '  ' });

    expect(events(auditCreateMany)).toMatchObject([
      { action: 'DISPATCHED', metadata: { awbNumber: 'AWB-9', courier: null } },
    ]);
  });

  it('refuses to dispatch without a tracking number', async () => {
    const { service, orderUpdateMany } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
    });

    await expect(
      service.dispatch(ORDER, { awbNumber: '   ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses an AWB another order already holds, naming that order (Q9)', async () => {
    const { service, orderUpdateMany, auditCreateMany } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      awbHolder: { awbNumber: 'AWB-1', orderNumber: 1000 },
    });

    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
    ).rejects.toThrow('AWB AWB-1 is already used by order #1000.');
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('turns the unique index refusing a raced AWB into the same 409', async () => {
    const { service, orderUpdateMany } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
    });
    orderUpdateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to dispatch an order QC has not verified', async () => {
    const { service } = makeService({ status: LogisticsStatus.INITIAL });

    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot re-dispatch: a dispatched AWB changes only through the correction', async () => {
    const { service, order } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
    });

    await service.dispatch(ORDER, { awbNumber: 'AWB-1' });
    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(order.awbNumber).toBe('AWB-1');
  });

  it('delivers a dispatched order', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
      role: UserRole.LOGISTICS_EXECUTIVE,
    });

    const result = await service.deliver(ORDER);

    expect(result.status).toBe(LogisticsStatus.DELIVERED);
    expect(order.deliveredAt).toBeInstanceOf(Date);
    expect(events(auditCreateMany)).toMatchObject([{ action: 'DELIVERED' }]);
  });
});

describe('LogisticsOrdersService — AWB correction after dispatch (Q9)', () => {
  it.each([
    LogisticsStatus.DISPATCHED,
    LogisticsStatus.DELIVERED,
    LogisticsStatus.RTO,
    LogisticsStatus.CANCELLED,
  ])(
    'corrects the AWB of a %s order and keeps the old one in history',
    async (status) => {
      const { service, order, auditCreateMany, queryRaw } = makeService({
        status,
        awbNumber: 'AWB-OLD',
      });

      const result = await service.correctAwb(ORDER, { awbNumber: 'AWB-NEW' });

      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(order.awbNumber).toBe('AWB-NEW');
      expect(result.status).toBe(status);
      expect(events(auditCreateMany)).toEqual([
        expect.objectContaining({
          entityType: 'LOGISTICS_ORDER',
          action: 'AWB_CORRECTED',
          source: 'logistics.awb',
          before: { awbNumber: 'AWB-OLD' },
          after: { awbNumber: 'AWB-NEW' },
        }),
      ]);
    },
  );

  it.each([
    LogisticsStatus.INITIAL,
    LogisticsStatus.QC_VERIFIED,
    LogisticsStatus.QC_REJECTED,
  ])('refuses a correction before dispatch (%s)', async (status) => {
    const { service, orderUpdate } = makeService({ status });

    await expect(
      service.correctAwb(ORDER, { awbNumber: 'AWB-NEW' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('refuses a corrected AWB another order holds', async () => {
    const { service, order, orderUpdate } = makeService({
      status: LogisticsStatus.DISPATCHED,
      awbNumber: 'AWB-OLD',
      awbHolder: { awbNumber: 'AWB-TAKEN', orderNumber: 999 },
    });

    await expect(
      service.correctAwb(ORDER, { awbNumber: 'AWB-TAKEN' }),
    ).rejects.toThrow('AWB AWB-TAKEN is already used by order #999.');
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(order.awbNumber).toBe('AWB-OLD');
  });

  it('turns the unique index refusing a raced corrected AWB into a 409', async () => {
    const { service, orderUpdate } = makeService({
      status: LogisticsStatus.DISPATCHED,
      awbNumber: 'AWB-OLD',
    });
    orderUpdate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const attempt = service.correctAwb(ORDER, { awbNumber: 'AWB-NEW' });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      'That AWB is already used by another order.',
    );
  });

  it('writes nothing when the AWB is unchanged', async () => {
    const { service, orderUpdate, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
      awbNumber: 'AWB-1',
    });

    await service.correctAwb(ORDER, { awbNumber: 'AWB-1' });

    expect(orderUpdate).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});

describe('LogisticsOrdersService — the Manager’s edit of a QC-verified order (Q5)', () => {
  const verified = () => makeService({ status: LogisticsStatus.QC_VERIFIED });

  it('writes and audits exactly the fields that change, and the order stays QC_VERIFIED', async () => {
    const { service, order, orderUpdate, leadUpdate, auditCreateMany } =
      verified();

    const result = await service.edit(ORDER, {
      city: 'Abu Dhabi',
      street: 'Corniche Rd',
      customerName: 'Acme Trading',
      productQty: '3',
    });

    expect(result.status).toBe(LogisticsStatus.QC_VERIFIED);
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: ORDER },
      data: { city: 'Abu Dhabi', street: 'Corniche Rd', productQty: '3' },
    });
    expect(order.status).toBe(LogisticsStatus.QC_VERIFIED);
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(events(auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'LOGISTICS_ORDER',
        action: 'UPDATED',
        source: 'logistics.edit',
        actorId: USER,
        before: { city: 'Dubai', street: null, productQty: '2' },
        after: { city: 'Abu Dhabi', street: 'Corniche Rd', productQty: '3' },
      }),
    ]);
  });

  it('clears a field sent as null', async () => {
    const { service, order } = verified();

    await service.edit(ORDER, { product: null });

    expect(order.product).toBeNull();
  });

  it('compares decimals by value, so 250.00 is no change from 250', async () => {
    const { service, orderUpdate, auditCreateMany } = verified();

    await service.edit(ORDER, { orderValue: '250.00' });

    expect(orderUpdate).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it.each([
    LogisticsStatus.INITIAL,
    LogisticsStatus.QC_REJECTED,
    LogisticsStatus.DISPATCHED,
    LogisticsStatus.DELIVERED,
  ])('refuses an edit while the order is %s', async (status) => {
    const { service, orderUpdate } = makeService({ status });

    await expect(
      service.edit(ORDER, { city: 'Abu Dhabi' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('leaves the edited order dispatchable — no return to QC', async () => {
    const { service } = verified();

    await service.edit(ORDER, { city: 'Abu Dhabi' });
    const result = await service.dispatch(ORDER, { awbNumber: 'AWB-7' });

    expect(result.status).toBe(LogisticsStatus.DISPATCHED);
  });
});

/*
  CD-3: cancellation only after dispatch. CD-4: RTO is a status of its own, reached only from
  DISPATCHED. Q6: an RTO order later moves to CANCELLED. Q7/Q8: both reasons are mandatory.
*/
describe('LogisticsOrdersService — cancellation and RTO', () => {
  it.each([LogisticsStatus.INITIAL, LogisticsStatus.QC_VERIFIED])(
    'refuses to cancel an order that is still %s',
    async (status) => {
      const { service, order } = makeService({ status });

      await expect(
        service.cancel(ORDER, reason('Customer refused')),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(order.cancelledAt).toBeNull();
    },
  );

  it('cancels a dispatched order, with its reason and time', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
      role: UserRole.LOGISTICS_EXECUTIVE,
    });

    const result = await service.cancel(ORDER, reason('Customer refused'));

    expect(result.status).toBe(LogisticsStatus.CANCELLED);
    expect(order.cancelReason).toBe('Customer refused');
    expect(order.cancelledAt).toBeInstanceOf(Date);
    expect(events(auditCreateMany)).toMatchObject([
      { action: 'CANCELLED', metadata: { reason: 'Customer refused' } },
    ]);
  });

  it('returns a dispatched order to origin', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
    });

    const result = await service.rto(ORDER, reason('Nobody at address'));

    expect(result.status).toBe(LogisticsStatus.RTO);
    expect(order.rtoReason).toBe('Nobody at address');
    expect(order.rtoAt).toBeInstanceOf(Date);
    expect(events(auditCreateMany)).toMatchObject([
      { action: 'RTO', metadata: { reason: 'Nobody at address' } },
    ]);
  });

  /*
    Q7: an RTO order never enters Accounts. There is no Accounts model yet, so what is pinned
    is the rule that holds whatever comes later: the RTO touches the order and its own event,
    and creates nothing else — no lead write, no other record.
  */
  it('writes only the order and its own event on RTO — nothing enters Accounts', async () => {
    const { service, leadUpdate, createManyAndReturn, auditCreateMany } =
      makeService({ status: LogisticsStatus.DISPATCHED });

    await service.rto(ORDER, reason('Nobody at address'));

    expect(leadUpdate).not.toHaveBeenCalled();
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(events(auditCreateMany)).toEqual([
      expect.objectContaining({ entityType: 'LOGISTICS_ORDER', action: 'RTO' }),
    ]);
  });

  it('moves an RTO order to CANCELLED, keeping the RTO record beside it (Q6)', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
    });
    await service.rto(ORDER, reason('Nobody at address'));

    const result = await service.cancel(ORDER, reason('Closed after RTO'));

    expect(result.status).toBe(LogisticsStatus.CANCELLED);
    expect(order.rtoReason).toBe('Nobody at address');
    expect(order.cancelReason).toBe('Closed after RTO');
    expect(events(auditCreateMany).at(-1)).toMatchObject({
      action: 'CANCELLED',
      before: { status: 'RTO' },
      after: { status: 'CANCELLED' },
    });
  });

  /*
    Pinned as it stands today: the client confirmed DISPATCHED → RTO and asked for no other RTO
    transition, so a delivered order cannot be returned through the system.
  */
  it('refuses RTO for an order that has already been delivered', async () => {
    const { service, order } = makeService({
      status: LogisticsStatus.DELIVERED,
    });

    await expect(
      service.rto(ORDER, reason('Customer returned it next week')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(order.status).toBe(LogisticsStatus.DELIVERED);
    expect(order.rtoAt).toBeNull();
  });

  it('refuses RTO for an order that never shipped', async () => {
    const { service } = makeService({ status: LogisticsStatus.QC_VERIFIED });

    await expect(service.rto(ORDER, reason('x'))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('LogisticsOrdersService — terminal states', () => {
  const attempt = (
    service: LogisticsOrdersService,
    action: LogisticsAction,
  ): Promise<unknown> => {
    switch (action) {
      case 'QC_VERIFY':
        return service.qcVerify(ORDER, {});
      case 'QC_REJECT':
        return service.qcReject(ORDER, { remarks: 'x' });
      case 'RESUBMIT':
        return service.resubmit(ORDER, {});
      case 'DISPATCH':
        return service.dispatch(ORDER, { awbNumber: 'AWB-1' });
      case 'DELIVER':
        return service.deliver(ORDER);
      case 'CANCEL':
        return service.cancel(ORDER, reason('x'));
      case 'RTO':
        return service.rto(ORDER, reason('x'));
    }
  };
  const ALL = Object.keys(LOGISTICS_TRANSITIONS) as LogisticsAction[];

  // Q8: once cancelled, the order cannot move to another status.
  it.each([LogisticsStatus.DELIVERED, LogisticsStatus.CANCELLED])(
    'lets nothing move an order that is %s',
    async (status) => {
      for (const action of ALL) {
        const { service, order } = makeService({ status });

        await expect(attempt(service, action)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(order.status).toBe(status);
      }
    },
  );

  it('lets an RTO order move to CANCELLED and nowhere else', async () => {
    for (const action of ALL.filter((name) => name !== 'CANCEL')) {
      const { service, order } = makeService({ status: LogisticsStatus.RTO });

      await expect(attempt(service, action)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.status).toBe(LogisticsStatus.RTO);
    }
  });
});

/*
  The confirmed matrix (2026-10-01), written out by hand: the table must equal it exactly, and
  every one of the 7 statuses × 7 moves is run through the service — the allowed ones land on
  their target, every other one is a 409 that leaves the order and the log untouched.
*/
describe('LogisticsOrdersService — the full transition matrix', () => {
  const S = LogisticsStatus;
  const MATRIX: Record<LogisticsAction, [LogisticsStatus[], LogisticsStatus]> =
    {
      QC_VERIFY: [[S.INITIAL], S.QC_VERIFIED],
      QC_REJECT: [[S.INITIAL], S.QC_REJECTED],
      RESUBMIT: [[S.QC_REJECTED], S.INITIAL],
      DISPATCH: [[S.QC_VERIFIED], S.DISPATCHED],
      DELIVER: [[S.DISPATCHED], S.DELIVERED],
      CANCEL: [[S.DISPATCHED, S.RTO], S.CANCELLED],
      RTO: [[S.DISPATCHED], S.RTO],
    };
  const run = (service: LogisticsOrdersService, action: LogisticsAction) => {
    switch (action) {
      case 'QC_VERIFY':
        return service.qcVerify(ORDER, {});
      case 'QC_REJECT':
        return service.qcReject(ORDER, { remarks: 'Wrong address' });
      case 'RESUBMIT':
        return service.resubmit(ORDER, {});
      case 'DISPATCH':
        return service.dispatch(ORDER, { awbNumber: 'AWB-1' });
      case 'DELIVER':
        return service.deliver(ORDER);
      case 'CANCEL':
        return service.cancel(ORDER, reason('Customer refused'));
      case 'RTO':
        return service.rto(ORDER, reason('Nobody at address'));
    }
  };

  it('is exactly the confirmed table, no move more or less', () => {
    expect(
      Object.fromEntries(
        Object.entries(LOGISTICS_TRANSITIONS).map(([action, move]) => [
          action,
          [move.from, move.to],
        ]),
      ),
    ).toEqual(MATRIX);
  });

  it('treats DELIVERED and CANCELLED, and only they, as terminal', () => {
    const left = new Set(Object.values(MATRIX).flatMap(([from]) => from));
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      Object.values(S)
        .filter((status) => !left.has(status))
        .sort(),
    );
  });

  it.each(
    Object.values(S).flatMap((status) =>
      (Object.keys(MATRIX) as LogisticsAction[]).map(
        (action): [LogisticsStatus, LogisticsAction] => [status, action],
      ),
    ),
  )('from %s, %s', async (status, action) => {
    const [from, to] = MATRIX[action];
    const { service, order, auditCreateMany } = makeService({
      status,
      leadStatus: status === S.QC_REJECTED ? 'QC NOT APPROVED' : 'WON',
    });

    if (from.includes(status)) {
      await expect(run(service, action)).resolves.toMatchObject({
        status: to,
      });
      expect(order.status).toBe(to);
    } else {
      await expect(run(service, action)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.status).toBe(status);
      expect(auditCreateMany).not.toHaveBeenCalled();
    }
  });

  /*
    A move is decided on the status just read, and that status is its event's "before". If a
    concurrent move commits in between — an RTO landing while a cancel was in flight — the write
    must not happen over the new status with the old one recorded: it is a 409 instead.
  */
  it('refuses a cancel overtaken by a concurrent RTO, and records nothing', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: S.DISPATCHED,
      racedTo: S.RTO,
    });

    await expect(
      service.cancel(ORDER, reason('Customer refused')),
    ).rejects.toThrow('This order is RTO; it cannot be moved to CANCELLED.');
    expect(order.status).toBe(S.RTO);
    expect(order.cancelledAt).toBeNull();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});

/*
  The open client questions this build answers provisionally. Each is pinned, so a change is a
  decision rather than a drift: the answer changes the code named in the test and this test.
*/
describe('LogisticsOrdersService — provisional answers, pinned (Q12, Q13, Q15, Q17)', () => {
  // Q15: matching is exact after trimming, so two AWBs differing only by case do not clash.
  it('Q15 — treats awb-1 and AWB-1 as different AWBs', async () => {
    const { service, orderFindFirst } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      awbHolder: { awbNumber: 'AWB-1', orderNumber: 1000 },
    });

    const result = await service.dispatch(ORDER, { awbNumber: 'awb-1' });

    expect(result.status).toBe(LogisticsStatus.DISPATCHED);
    const lookups = (orderFindFirst.mock.calls as [{ where: object }][])
      .map(([args]) => args.where)
      .filter((where) => 'awbNumber' in where);
    expect(lookups).toEqual([{ awbNumber: 'awb-1', NOT: { id: ORDER } }]);
  });

  // Q17: Order Value and Payment Method are editable, written and audited like any field.
  it('Q17 — lets the Manager change Order Value and Payment Method', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
    });

    await service.edit(ORDER, { orderValue: '300', paymentMethod: 'Card' });

    expect(order.orderValue).toBe('300');
    expect(order.paymentMethod).toBe('Card');
    expect(events(auditCreateMany)).toEqual([
      expect.objectContaining({
        action: 'UPDATED',
        before: { orderValue: '250', paymentMethod: null },
        after: { orderValue: '300', paymentMethod: 'Card' },
      }),
    ]);
  });

  it('Q17 — the editable fields are exactly these', () => {
    expect([...EDITABLE_ORDER_FIELDS]).toEqual([
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
    ]);
  });

  // Q12 / Q13: no list was supplied, so any non-blank reason is accepted.
  it.each(['Customer refused', 'Nobody at address — called twice'])(
    'Q12/Q13 — accepts the free-text reason %j',
    async (text) => {
      expect(await invalid(OrderReasonDto, { reason: text })).toEqual([]);
    },
  );
});

describe('LogisticsOrdersService — reading', () => {
  it.each([UserRole.LOGISTICS_EXECUTIVE, UserRole.QC])(
    'shows %s every order',
    async (role) => {
      const { service, listFindMany } = makeService({ role });

      const { rows, total } = await service.list(query());

      expect(total).toBe(1);
      expect(rows[0]).toMatchObject({ id: ORDER, orderNumber: 1001 });
      const [args] = listFindMany.mock.calls[0] as [{ where: unknown }];
      expect(JSON.stringify(args.where)).not.toContain('assignments');
    },
  );

  /*
    Sales read their own converted leads' orders and nothing else — the same lead scope the
    Leads list uses, applied in the query rather than in the UI.
  */
  it('shows a sales agent only the orders of leads they own', async () => {
    const { service, listFindMany } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.list(query({ leadId: LEAD }));

    const [args] = listFindMany.mock.calls[0] as [{ where: unknown }];
    const json = JSON.stringify(args.where);
    expect(json).toContain(`"userId":"${USER}"`);
    expect(json).toContain('"deletedAt":null');
    expect(json).toContain(`"leadId":"${LEAD}"`);
  });

  it('searches name, phone and AWB inside the caller’s own scope', async () => {
    const { service, listFindMany } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.list(query({ search: '  Acme ' }));

    const [args] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    const contains = { contains: 'Acme', mode: 'insensitive' };
    expect(args.where.AND).toContainEqual({
      OR: [
        { customerName: contains },
        { primaryPhone: contains },
        { awbNumber: contains },
      ],
    });
    // The scope term is still there beside it, so a search can only narrow.
    expect(JSON.stringify(args.where)).toContain(`"userId":"${USER}"`);
  });

  it.each(['1001', '#1001'])(
    'matches %s against the order number as well',
    async (search) => {
      const { service, listFindMany } = makeService({
        role: UserRole.LOGISTICS_MANAGER,
      });

      await service.list(query({ search }));

      const [args] = listFindMany.mock.calls[0] as [
        { where: { AND: { OR?: unknown[] }[] } },
      ];
      expect(args.where.AND.at(-1)?.OR?.[0]).toEqual({ orderNumber: 1001 });
    },
  );

  it('matches % and _ literally, and adds nothing for a blank search', async () => {
    const { service, listFindMany } = makeService({
      role: UserRole.LOGISTICS_MANAGER,
    });

    await service.list(query({ search: '50%_' }));
    await service.list(query({ search: '   ' }));

    const calls = listFindMany.mock.calls as [{ where: { AND: unknown[] } }][];
    expect(JSON.stringify(calls[0][0].where)).toContain('50\\\\%\\\\_');
    expect(calls[1][0].where.AND.at(-1)).toEqual({});
  });

  it('reads one order through the same scope', async () => {
    const { service, findFirst } = makeService({ role: UserRole.SALES_AGENT });

    await service.get(ORDER);

    const [args] = findFirst.mock.calls[0] as [{ where: unknown }];
    expect(JSON.stringify(args.where)).toContain(`"userId":"${USER}"`);
  });

  it('404s an order outside the caller’s scope', async () => {
    const { service, findFirst } = makeService({ role: UserRole.SALES_AGENT });
    findFirst.mockResolvedValue(null);

    await expect(service.get(ORDER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

/*
  Every order the API returns says what its caller may do to it now, from the one calculation
  in logistics-roles.ts — so the UI never has to work permissions out for itself.
*/
describe('LogisticsOrdersService — allowedActions on every response', () => {
  it('gives the Logistics Manager the shipment steps of a dispatched order', async () => {
    const { service } = makeService({
      status: LogisticsStatus.DISPATCHED,
      role: UserRole.LOGISTICS_MANAGER,
    });

    const order = await service.get(ORDER);

    expect(order.allowedActions).toEqual([
      'DELIVER',
      'CANCEL',
      'RTO',
      'CORRECT_AWB',
    ]);
  });

  it('gives a sales agent reading the list no action at all', async () => {
    const { service } = makeService({
      status: LogisticsStatus.QC_REJECTED,
      role: UserRole.SALES_AGENT,
    });

    const { rows } = await service.list(query());

    expect(rows[0].allowedActions).toEqual([]);
  });

  it('answers a transition with the actions of the status it just reached', async () => {
    const { service } = makeService({
      status: LogisticsStatus.INITIAL,
      role: UserRole.QC,
    });

    const result = await service.qcVerify(ORDER, {});

    expect(result.status).toBe(LogisticsStatus.QC_VERIFIED);
    // QC's part is done: a verified order offers QC nothing more.
    expect(result.allowedActions).toEqual([]);
  });
});

/** The body as the global ValidationPipe would see it: transformed, then validated. */
async function invalid<T extends object>(
  dto: new () => T,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));
  return errors.map((error) => error.property);
}

describe('Logistics DTOs — what the routes refuse before the service runs', () => {
  it.each([{}, { remarks: '' }, { remarks: '   ' }])(
    'requires a QC rejection reason: %j is refused (Q4)',
    async (body) => {
      expect(await invalid(QcRejectDto, body)).toEqual(['remarks']);
    },
  );

  it('accepts a free-text rejection reason, trimmed', async () => {
    const dto = plainToInstance(QcRejectDto, { remarks: '  Wrong address ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.remarks).toBe('Wrong address');
  });

  it('keeps approval remarks optional (Q4)', async () => {
    expect(await invalid(QcDecisionDto, {})).toEqual([]);
  });

  it.each([{}, { reason: '' }, { reason: '  ' }])(
    'requires a cancellation / RTO reason: %j is refused (Q7, Q8)',
    async (body) => {
      expect(await invalid(OrderReasonDto, body)).toEqual(['reason']);
    },
  );

  it('requires the corrected AWB', async () => {
    expect(await invalid(CorrectAwbDto, { awbNumber: ' ' })).toEqual([
      'awbNumber',
    ]);
  });

  it('refuses blanking the customer name or phone, and a non-number value', async () => {
    expect(
      await invalid(UpdateLogisticsOrderDto, {
        customerName: ' ',
        primaryPhone: '',
        orderValue: 'lots',
      }),
    ).toEqual(['customerName', 'primaryPhone', 'orderValue']);
  });

  /*
    The three decimal fields are `Decimal(12, 2)` columns. A wider value would be rounded by
    Postgres while the audit recorded the unrounded one, or refused with a 500 — so it is a 400.
  */
  it.each([
    ['orderValue', '250.555'],
    ['orderValue', '12345678901'],
    ['productQty', '1.005'],
    ['product2Qty', '1e5'],
  ])(
    'refuses %s = %j, which the column cannot hold exactly',
    async (field, value) => {
      expect(
        await invalid(UpdateLogisticsOrderDto, { [field]: value }),
      ).toEqual([field]);
    },
  );

  it.each(['250', '250.5', '250.55', '1234567890.99'])(
    'accepts the order value %j',
    async (value) => {
      expect(
        await invalid(UpdateLogisticsOrderDto, { orderValue: value }),
      ).toEqual([]);
    },
  );

  it('turns any other field sent blank into null — a clear', async () => {
    const dto = plainToInstance(UpdateLogisticsOrderDto, {
      street: '  ',
      email: '',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ street: null, email: null });
  });
});
