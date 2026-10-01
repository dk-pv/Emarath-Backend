import { ConflictException, NotFoundException } from '@nestjs/common';
import { LogisticsStatus, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LogisticsOrdersService } from './logistics-orders.service';
import { LOGISTICS_TRANSITIONS, LogisticsAction } from './logistics-status';
import { ListLogisticsOrdersDto } from './dto/logistics-order.dto';

const ORDER = '33333333-3333-3333-3333-333333333333';
const LEAD = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

interface Options {
  status?: LogisticsStatus;
  leadStatus?: string;
  role?: UserRole;
}

/**
 * A stateful double: the order and its lead are objects the writes mutate, so a transition's
 * conditional update behaves as the database would — it changes the row only when the current
 * status is one the transition allows.
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
    secondaryPhone: null,
    email: null,
    country: null,
    state: null,
    city: null,
    street: null,
    nationalCode: null,
    product: null,
    productQty: null,
    product2: null,
    product2Qty: null,
    orderValue: null,
    paymentMethod: null,
    qcDecidedAt: null,
    qcRemarks: null,
    awbNumber: null,
    courier: null,
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    rtoAt: null,
    rtoReason: null,
  };
  const lead = { status: options.leadStatus ?? 'WON' };

  const orderUpdateMany = jest.fn(
    (args: {
      where: { id: string; status: { in: LogisticsStatus[] } };
      data: Record<string, unknown>;
    }) => {
      if (!args.where.status.in.includes(order.status)) {
        return Promise.resolve({ count: 0 });
      }
      Object.assign(order, args.data);
      return Promise.resolve({ count: 1 });
    },
  );
  const orderFindUnique = jest.fn((args: { where: { id: string } }) =>
    Promise.resolve(args.where.id === ORDER ? { ...order } : null),
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

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    logisticsOrder: {
      findUnique: orderFindUnique,
      updateMany: orderUpdateMany,
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
      team: null,
    }),
  } as unknown as CurrentUserService;

  return {
    service: new LogisticsOrdersService(prisma, currentUser),
    order,
    lead,
    orderUpdateMany,
    leadUpdate,
    auditCreateMany,
    createManyAndReturn,
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

describe('LogisticsOrdersService — QC', () => {
  it('verifies an order waiting for QC, and leaves the lead alone', async () => {
    const { service, order, leadUpdate, auditCreateMany } = makeService();

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

  /*
    The order's `qcRemarks` column holds the LATEST QC note, so a later resubmit overwrites it
    — and a resubmit with no note empties it. The audit log is append-only, so the reason this
    rejection gave survives however many times the order goes round afterwards. Nothing about
    what `qcRemarks` means has changed; the history simply no longer loses it.
  */
  it('keeps the rejection reason in history when a resubmit clears the column', async () => {
    const { service, order, auditCreateMany } = makeService();

    await service.qcReject(ORDER, { remarks: 'Wrong delivery address' });
    expect(order.qcRemarks).toBe('Wrong delivery address');

    await service.resubmit(ORDER, {});

    expect(order.qcRemarks).toBeNull();
    const written = events(auditCreateMany);
    expect(
      written.find((event) => event.action === 'QC_REJECTED')?.metadata,
    ).toEqual({ remarks: 'Wrong delivery address' });
    expect(
      written.find((event) => event.action === 'RESUBMITTED')?.metadata,
    ).toEqual({ remarks: null });
  });

  /*
    CD-1: the lead goes to the stage the client already uses, never a new one — and it happens
    in the rejection's own transaction, so an order can never read QC_REJECTED behind a lead
    that still reads WON.
  */
  it('rejects the order and moves the lead to QC NOT APPROVED in one transaction', async () => {
    const { service, order, lead, leadUpdate, auditCreateMany } = makeService();

    const result = await service.qcReject(ORDER, { remarks: 'Wrong address' });

    expect(result.status).toBe(LogisticsStatus.QC_REJECTED);
    expect(lead.status).toBe('QC NOT APPROVED');
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: LEAD },
      data: { status: 'QC NOT APPROVED', lostReason: null },
    });
    expect(order.qcRemarks).toBe('Wrong address');
    // Both halves are audited, and the lead's event names the order it came from.
    expect(events(auditCreateMany)).toMatchObject([
      { entityType: 'LOGISTICS_ORDER', action: 'QC_REJECTED' },
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
      status: LogisticsStatus.DISPATCHED,
    });

    await expect(service.qcReject(ORDER, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('404s an order that does not exist', async () => {
    const { service } = makeService();

    await expect(
      service.qcVerify('44444444-4444-4444-4444-444444444444', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/*
  CD-2: the corrected order goes back through QC. The same order, never a second one — which
  is why resubmit is a business action rather than an editable status.
*/
describe('LogisticsOrdersService — resubmit', () => {
  it('returns the rejected order to INITIAL and the lead to WON', async () => {
    const { service, lead, leadUpdate, auditCreateMany } = makeService({
      status: LogisticsStatus.QC_REJECTED,
      leadStatus: 'QC NOT APPROVED',
    });

    const result = await service.resubmit(ORDER, { remarks: 'Address fixed' });

    expect(result.status).toBe(LogisticsStatus.INITIAL);
    expect(lead.status).toBe('WON');
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: LEAD },
      data: { status: 'WON', lostReason: null },
    });
    expect(events(auditCreateMany)).toMatchObject([
      { entityType: 'LOGISTICS_ORDER', action: 'RESUBMITTED' },
      {
        entityType: 'LEAD',
        action: 'CONVERTED',
        source: 'logistics.resubmit',
        metadata: { orderId: ORDER },
      },
    ]);
  });

  it('creates no second order when the lead becomes WON again', async () => {
    const { service, createManyAndReturn, auditCreateMany } = makeService({
      status: LogisticsStatus.QC_REJECTED,
      leadStatus: 'QC NOT APPROVED',
    });

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

  it('refuses to resubmit an order QC has not rejected', async () => {
    const { service } = makeService({ status: LogisticsStatus.INITIAL });

    await expect(service.resubmit(ORDER, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('LogisticsOrdersService — shipment', () => {
  it('dispatches a verified order, recording the AWB and the time', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
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

  it('refuses to dispatch an order QC has not verified', async () => {
    const { service } = makeService({ status: LogisticsStatus.INITIAL });

    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /*
    The AWB is written only by DISPATCH, whose source status is QC_VERIFIED — and a dispatched
    order can never return there — so a tracking number cannot be corrected once it is set.
    Pinned as current behaviour; whether it should be editable is still with the client.
  */
  it('cannot change the AWB once the order has been dispatched', async () => {
    const { service, order } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
    });

    await service.dispatch(ORDER, { awbNumber: 'AWB-1' });
    expect(order.awbNumber).toBe('AWB-1');

    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(order.awbNumber).toBe('AWB-1');
  });

  it('delivers a dispatched order', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
    });

    const result = await service.deliver(ORDER);

    expect(result.status).toBe(LogisticsStatus.DELIVERED);
    expect(order.deliveredAt).toBeInstanceOf(Date);
    expect(events(auditCreateMany)).toMatchObject([{ action: 'DELIVERED' }]);
  });
});

/*
  CD-3: cancellation only after dispatch. CD-4: RTO is a status of its own, reached only from
  DISPATCHED. Both are the transition table's business, so nothing else has to remember them.
*/
describe('LogisticsOrdersService — cancellation and RTO', () => {
  it.each([LogisticsStatus.INITIAL, LogisticsStatus.QC_VERIFIED])(
    'refuses to cancel an order that is still %s',
    async (status) => {
      const { service, order } = makeService({ status });

      await expect(service.cancel(ORDER, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.cancelledAt).toBeNull();
    },
  );

  it('cancels a dispatched order, with its reason and time', async () => {
    const { service, order, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
    });

    const result = await service.cancel(ORDER, { reason: 'Customer refused' });

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

    const result = await service.rto(ORDER, { reason: 'Nobody at address' });

    expect(result.status).toBe(LogisticsStatus.RTO);
    expect(order.rtoReason).toBe('Nobody at address');
    expect(order.rtoAt).toBeInstanceOf(Date);
    expect(events(auditCreateMany)).toMatchObject([
      { action: 'RTO', metadata: { reason: 'Nobody at address' } },
    ]);
  });

  /*
    The reasons stay optional — whether either is mandatory is still with the client — so an
    event without one says so explicitly rather than leaving the key out.
  */
  it.each([
    ['cancel', 'CANCELLED'],
    ['rto', 'RTO'],
  ] as const)(
    'records a %s with no reason as a null reason',
    async (method, action) => {
      const { service, auditCreateMany } = makeService({
        status: LogisticsStatus.DISPATCHED,
      });

      await service[method](ORDER, {});

      expect(events(auditCreateMany)).toMatchObject([
        { action, metadata: { reason: null } },
      ]);
    },
  );

  /*
    Pinned as it stands today: the client confirmed DISPATCHED → RTO and asked for no other RTO
    transition, so a delivered order cannot be returned through the system. Whether a
    post-delivery return should exist is still with the client.
  */
  it('refuses RTO for an order that has already been delivered', async () => {
    const { service, order } = makeService({
      status: LogisticsStatus.DELIVERED,
    });

    await expect(
      service.rto(ORDER, { reason: 'Customer returned it next week' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(order.status).toBe(LogisticsStatus.DELIVERED);
    expect(order.rtoAt).toBeNull();
  });

  it('refuses RTO for an order that never shipped', async () => {
    const { service } = makeService({ status: LogisticsStatus.QC_VERIFIED });

    await expect(service.rto(ORDER, {})).rejects.toBeInstanceOf(
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
        return service.qcReject(ORDER, {});
      case 'RESUBMIT':
        return service.resubmit(ORDER, {});
      case 'DISPATCH':
        return service.dispatch(ORDER, { awbNumber: 'AWB-1' });
      case 'DELIVER':
        return service.deliver(ORDER);
      case 'CANCEL':
        return service.cancel(ORDER, {});
      case 'RTO':
        return service.rto(ORDER, {});
    }
  };

  it.each([
    LogisticsStatus.DELIVERED,
    LogisticsStatus.CANCELLED,
    LogisticsStatus.RTO,
  ])('lets nothing move an order that is %s', async (status) => {
    for (const action of Object.keys(
      LOGISTICS_TRANSITIONS,
    ) as LogisticsAction[]) {
      const { service, order } = makeService({ status });

      await expect(attempt(service, action)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(order.status).toBe(status);
    }
  });
});

describe('LogisticsOrdersService — reading', () => {
  it('shows Logistics every order', async () => {
    const { service, listFindMany } = makeService({
      role: UserRole.LOGISTICS_EXECUTIVE,
    });

    const { rows, total } = await service.list(query());

    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ id: ORDER, orderNumber: 1001 });
    const [args] = listFindMany.mock.calls[0] as [{ where: unknown }];
    expect(JSON.stringify(args.where)).not.toContain('assignments');
  });

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

    expect(order.allowedActions).toEqual(['DELIVER', 'CANCEL', 'RTO']);
  });

  it('gives a sales agent reading the list no action at all', async () => {
    const { service } = makeService({
      status: LogisticsStatus.DISPATCHED,
      role: UserRole.SALES_AGENT,
    });

    const { rows } = await service.list(query());

    expect(rows[0].allowedActions).toEqual([]);
  });

  it('answers a transition with the actions of the status it just reached', async () => {
    const { service } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      role: UserRole.LOGISTICS_MANAGER,
    });

    const result = await service.dispatch(ORDER, { awbNumber: 'AWB-1' });

    expect(result.status).toBe(LogisticsStatus.DISPATCHED);
    expect(result.allowedActions).toEqual(['DELIVER', 'CANCEL', 'RTO']);
  });

  it('offers nothing on an order waiting for QC while the QC role is unconfirmed', async () => {
    const { service } = makeService({
      status: LogisticsStatus.INITIAL,
      role: UserRole.LOGISTICS_EXECUTIVE,
    });

    const order = await service.get(ORDER);

    expect(order.allowedActions).toEqual([]);
  });
});
