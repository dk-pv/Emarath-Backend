import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  LogisticsOrderFiltersDto,
  OrderReasonDto,
  QcDecisionDto,
  QcRejectDto,
  CorrectDeliveryDateDto,
  SetDeliveryDateDto,
  UpdateLogisticsOrderDto,
} from './dto/logistics-order.dto';

const ORDER = '33333333-3333-3333-3333-333333333333';
const LEAD = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
/** A delivery day, for the orders a move needs to be dated (QC verification and dispatch). */
const DATED = new Date('2026-10-20T00:00:00.000Z');

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
  /** A stage the lead's pipeline lacks, as a pipeline created without it would. */
  missingStage?: string;
  /** The order's planned delivery day (its DATE column), when it has one. */
  deliveryDate?: Date;
  /** BUSINESS_TIME_ZONE; Asia/Dubai when not given. */
  timeZone?: string;
  /** The pipelines closed to the caller (ADR-0093), as `CurrentUserService` attaches them. */
  deniedPipelines?: string[];
  /** The lead's pipeline; Lead Pipeline when not given. */
  leadPipeline?: string;
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
    deliveryDate: options.deliveryDate ?? (null as Date | null),
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
  const leadPipeline = options.leadPipeline ?? 'Lead Pipeline';
  // The lead's audit row, built from the lead as it stands, so the change core's before/after
  // reads differ exactly when the write-back moved it. Asked which leads sit in some pipelines
  // — the closed-pipeline check — it answers for this lead's own.
  const leadFindMany = jest.fn((args?: { where?: { pipeline?: unknown } }) => {
    const pipeline = args?.where?.pipeline as { in: string[] } | undefined;
    if (pipeline) {
      return Promise.resolve(
        pipeline.in.includes(leadPipeline) ? [{ id: LEAD }] : [],
      );
    }
    return Promise.resolve([
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
        pipeline: leadPipeline,
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
    ]);
  });
  const leadUpdate = jest.fn((args: { data: { status: string } }) => {
    lead.status = args.data.status;
    return Promise.resolve({ id: LEAD });
  });
  const leadFindUnique = jest
    .fn()
    .mockResolvedValue({ pipeline: leadPipeline });
  const stageFindUnique = jest.fn(
    (args: { where: { pipeline_name: { name: string } } }) =>
      Promise.resolve(
        args.where.pipeline_name.name === options.missingStage
          ? null
          : { id: 'stage-1' },
      ),
  );
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  // The lead already has this order, so the guard sees it and the conversion keeps it.
  const orderFindMany = jest
    .fn()
    .mockResolvedValue([{ id: ORDER, leadId: LEAD }]);
  const createManyAndReturn = jest.fn().mockResolvedValue([]);
  const queryRaw = jest.fn().mockResolvedValue([]);
  // The Accounts record a delivery opens (ADR-0096), as the database would return it.
  const accountsCreate = jest
    .fn()
    .mockResolvedValue({ id: 'record-1', status: 'INITIAL' });

  const tx = {
    $queryRaw: queryRaw,
    accountsRecord: { create: accountsCreate },
    logisticsOrder: {
      findUnique: orderFindUnique,
      findFirst: orderFindFirst,
      updateMany: orderUpdateMany,
      update: orderUpdate,
      findMany: orderFindMany,
      createManyAndReturn,
    },
    lead: {
      findMany: leadFindMany,
      findUnique: leadFindUnique,
      findUniqueOrThrow: leadFindUnique,
      update: leadUpdate,
    },
    stage: { findUnique: stageFindUnique },
    auditEvent: { createMany: auditCreateMany },
  };
  const listFindMany = jest.fn().mockResolvedValue([{ ...order }]);
  const listCount = jest.fn().mockResolvedValue(1);
  const findFirst = jest.fn().mockResolvedValue({ ...order });
  const groupBy = jest.fn().mockResolvedValue([]);
  const userFindMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    $transaction: jest.fn(
      (arg: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(tx),
    ),
    logisticsOrder: {
      findMany: listFindMany,
      count: listCount,
      findFirst,
      groupBy,
    },
    lead: { findMany: leadFindMany },
    user: { findMany: userFindMany },
  } as unknown as PrismaService;

  // The business timezone, as configuration.ts reads it from BUSINESS_TIME_ZONE.
  const config = {
    getOrThrow: () => ({ businessTimeZone: options.timeZone ?? 'Asia/Dubai' }),
  } as unknown as ConfigService;

  const resolve = jest.fn();
  /** Who the next calls come from — one order, worked by several roles in turn. */
  const as = (role: UserRole) =>
    resolve.mockResolvedValue({
      id: USER,
      role,
      team: options.team ?? null,
      deniedPipelines: options.deniedPipelines,
    });
  as(options.role ?? UserRole.LOGISTICS_MANAGER);
  const currentUser = { resolve } as unknown as CurrentUserService;

  return {
    service: new LogisticsOrdersService(prisma, currentUser, config),
    as,
    order,
    lead,
    orderUpdateMany,
    orderUpdate,
    orderFindFirst,
    leadFindMany,
    leadUpdate,
    auditCreateMany,
    createManyAndReturn,
    queryRaw,
    accountsCreate,
    listFindMany,
    listCount,
    findFirst,
    groupBy,
    userFindMany,
    stageFindUnique,
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
): ListLogisticsOrdersDto => ({
  page: 1,
  size: 50,
  sort: 'convertedAt',
  direction: 'desc',
  ...over,
});

const reason = (text: string): OrderReasonDto => ({ reason: text });

/** Where the search sits among `orderWhere`'s AND terms: scope, status, country, city, lead, search. */
const SEARCH_TERM = 5;

describe('LogisticsOrdersService — QC', () => {
  it('verifies an order waiting for QC, and leaves the lead alone', async () => {
    const { service, order, leadUpdate, auditCreateMany } = makeService({
      deliveryDate: DATED,
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
      deliveryDate: DATED,
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

/*
  A write-back sets the lead's status by name. On a pipeline without that stage the lead would
  sit in no column of its board while the order moved on, so the whole move is refused.
*/
describe('LogisticsOrdersService — the write-back’s stage must exist', () => {
  const CASES: [
    string,
    string,
    Options,
    (service: LogisticsOrdersService) => Promise<unknown>,
  ][] = [
    [
      'a QC rejection',
      'QC NOT APPROVED',
      { role: UserRole.QC },
      (service) => service.qcReject(ORDER, { remarks: 'Wrong address' }),
    ],
    [
      'a resubmit',
      'WON',
      {
        status: LogisticsStatus.QC_REJECTED,
        leadStatus: 'QC NOT APPROVED',
        role: UserRole.SALES_MANAGER,
        team: 'Dubai',
      },
      (service) => service.resubmit(ORDER, {}),
    ],
  ];

  it.each(CASES)(
    'refuses %s when the lead’s pipeline has no %s stage, and leaves the lead alone',
    async (_label, stage, options, act) => {
      const { service, leadUpdate, stageFindUnique } = makeService({
        ...options,
        missingStage: stage,
      });

      const attempt = act(service);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(`no “${stage}” stage`);
      expect(stageFindUnique).toHaveBeenCalledWith({
        where: { pipeline_name: { pipeline: 'Lead Pipeline', name: stage } },
        select: { id: true },
      });
      // Thrown inside the move's transaction before the lead is written, so the move rolls back.
      expect(leadUpdate).not.toHaveBeenCalled();
    },
  );

  /*
    Only a write-back needs its stage. Every other move leaves the lead alone, so it works on
    such a pipeline exactly as before and never reads its stages.
  */
  it.each([
    [
      'QC verification',
      LogisticsStatus.INITIAL,
      UserRole.QC,
      (service: LogisticsOrdersService) => service.qcVerify(ORDER, {}),
      LogisticsStatus.QC_VERIFIED,
    ],
    [
      'dispatch',
      LogisticsStatus.QC_VERIFIED,
      UserRole.LOGISTICS_EXECUTIVE,
      (service: LogisticsOrdersService) =>
        service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
      LogisticsStatus.DISPATCHED,
    ],
    [
      'delivery',
      LogisticsStatus.DISPATCHED,
      UserRole.LOGISTICS_EXECUTIVE,
      (service: LogisticsOrdersService) => service.deliver(ORDER),
      LogisticsStatus.DELIVERED,
    ],
  ] as const)(
    'lets %s through on a pipeline without the reserved stages, never reading them',
    async (_label, status, role, act, reached) => {
      const { service, order, leadUpdate, stageFindUnique } = makeService({
        deliveryDate: DATED,
        status,
        role,
        missingStage: 'QC NOT APPROVED',
      });

      await act(service);

      expect(order.status).toBe(reached);
      expect(stageFindUnique).not.toHaveBeenCalled();
      expect(leadUpdate).not.toHaveBeenCalled();
    },
  );
});

describe('LogisticsOrdersService — dispatch and the AWB', () => {
  it('dispatches a verified order, recording the AWB and the time', async () => {
    const { service, order, auditCreateMany } = makeService({
      deliveryDate: DATED,
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
      deliveryDate: DATED,
      status: LogisticsStatus.QC_VERIFIED,
    });

    await service.dispatch(ORDER, { awbNumber: 'AWB-9', courier: '  ' });

    expect(events(auditCreateMany)).toMatchObject([
      { action: 'DISPATCHED', metadata: { awbNumber: 'AWB-9', courier: null } },
    ]);
  });

  it('refuses to dispatch without a tracking number', async () => {
    const { service, orderUpdateMany } = makeService({
      deliveryDate: DATED,
      status: LogisticsStatus.QC_VERIFIED,
    });

    await expect(
      service.dispatch(ORDER, { awbNumber: '   ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses an AWB another order already holds, naming that order (Q9)', async () => {
    const { service, orderUpdateMany, auditCreateMany } = makeService({
      deliveryDate: DATED,
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
      deliveryDate: DATED,
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
    const { service } = makeService({
      deliveryDate: DATED,
      status: LogisticsStatus.INITIAL,
    });

    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot re-dispatch: a dispatched AWB changes only through the correction', async () => {
    const { service, order } = makeService({
      deliveryDate: DATED,
      status: LogisticsStatus.QC_VERIFIED,
    });

    await service.dispatch(ORDER, { awbNumber: 'AWB-1' });
    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(order.awbNumber).toBe('AWB-1');
  });

  it('delivers a dispatched order, and opens its Accounts record in the same transaction (§4 step 11)', async () => {
    const { service, order, auditCreateMany, accountsCreate } = makeService({
      deliveryDate: DATED,
      status: LogisticsStatus.DISPATCHED,
      role: UserRole.LOGISTICS_EXECUTIVE,
    });

    const result = await service.deliver(ORDER);

    expect(result.status).toBe(LogisticsStatus.DELIVERED);
    expect(order.deliveredAt).toBeInstanceOf(Date);
    expect(accountsCreate).toHaveBeenCalledTimes(1);
    expect(accountsCreate).toHaveBeenCalledWith({
      data: { orderId: ORDER },
      select: { id: true, status: true },
    });
    expect(events(auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'LOGISTICS_ORDER',
        action: 'DELIVERED',
      }),
      {
        entityType: 'ACCOUNTS_RECORD',
        entityId: 'record-1',
        leadId: LEAD,
        action: 'ACCOUNTS_CREATED',
        actorType: 'USER',
        actorId: USER,
        source: 'logistics.deliver',
        before: undefined,
        after: { status: 'INITIAL' },
        metadata: { orderId: ORDER },
      },
    ]);
  });

  /*
    The unique key on the record's order is the backstop. Its refusal must read as what it is —
    never as the AWB clash every other unique refusal on a move used to be reported as.
  */
  it('reports a second Accounts record as an Accounts 409, not an AWB clash', async () => {
    const { service, accountsCreate } = makeService({
      deliveryDate: DATED,
      status: LogisticsStatus.DISPATCHED,
    });
    accountsCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.deliver(ORDER)).rejects.toThrow(
      new ConflictException(
        'This order already has an Accounts record, so the delivery was not recorded.',
      ),
    );
  });

  it('opens no Accounts record when the delivery is refused', async () => {
    const { service, accountsCreate, auditCreateMany } = makeService({
      status: LogisticsStatus.DISPATCHED,
      racedTo: LogisticsStatus.RTO,
    });

    await expect(service.deliver(ORDER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});

/*
  Q7 and Q13: only a delivered order enters Accounts — every other move, a cancellation and an RTO
  among them, opens no record.
*/
describe('LogisticsOrdersService — only DELIVERED opens an Accounts record', () => {
  const MOVES: [
    LogisticsStatus,
    (s: LogisticsOrdersService) => Promise<unknown>,
  ][] = [
    [LogisticsStatus.INITIAL, (s) => s.qcVerify(ORDER, {})],
    [LogisticsStatus.INITIAL, (s) => s.qcReject(ORDER, { remarks: 'x' })],
    [LogisticsStatus.QC_REJECTED, (s) => s.resubmit(ORDER, {})],
    [
      LogisticsStatus.QC_VERIFIED,
      (s) => s.dispatch(ORDER, { awbNumber: 'AWB-1' }),
    ],
    [LogisticsStatus.DISPATCHED, (s) => s.cancel(ORDER, reason('x'))],
    [LogisticsStatus.DISPATCHED, (s) => s.rto(ORDER, reason('x'))],
    [LogisticsStatus.RTO, (s) => s.cancel(ORDER, reason('x'))],
  ];

  it.each(MOVES)('from %s, %s', async (status, move) => {
    const { service, accountsCreate, order } = makeService({
      status,
      deliveryDate: DATED,
      leadStatus:
        status === LogisticsStatus.QC_REJECTED ? 'QC NOT APPROVED' : 'WON',
    });

    await move(service);

    expect(order.status).not.toBe(status);
    expect(accountsCreate).not.toHaveBeenCalled();
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
    const { service } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      deliveryDate: DATED,
    });

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
    Q7: an RTO order never enters Accounts. The RTO touches the order and its own event, and
    creates nothing else — no lead write, no Accounts record (ADR-0096), no other record.
  */
  it('writes only the order and its own event on RTO — nothing enters Accounts', async () => {
    const {
      service,
      leadUpdate,
      createManyAndReturn,
      auditCreateMany,
      accountsCreate,
    } = makeService({ status: LogisticsStatus.DISPATCHED });

    await service.rto(ORDER, reason('Nobody at address'));

    expect(leadUpdate).not.toHaveBeenCalled();
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(accountsCreate).not.toHaveBeenCalled();
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
      deliveryDate: DATED,
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
      deliveryDate: DATED,
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

  // The delivery date (ADR-0094) joined the same edit, under the same role and status rules.
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
      'deliveryDate',
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
      expect(args.where.AND[SEARCH_TERM]?.OR?.[0]).toEqual({
        orderNumber: 1001,
      });
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
    expect(calls[1][0].where.AND[SEARCH_TERM]).toEqual({});
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

  it('lists newest first by default, with the id breaking ties', async () => {
    const { service, listFindMany } = makeService();

    await service.list(query());

    const [args] = listFindMany.mock.calls[0] as [{ orderBy: unknown }];
    expect(args.orderBy).toEqual([{ convertedAt: 'desc' }, { id: 'asc' }]);
  });

  it.each([
    ['orderNumber', 'asc'],
    ['customerName', 'asc'],
    ['status', 'desc'],
    ['statusChangedAt', 'asc'],
  ] as const)(
    'sorts by %s %s, still tie-broken by id',
    async (sort, direction) => {
      const { service, listFindMany } = makeService();

      await service.list(query({ sort, direction }));

      const [args] = listFindMany.mock.calls[0] as [{ orderBy: unknown }];
      expect(args.orderBy).toEqual([{ [sort]: direction }, { id: 'asc' }]);
    },
  );

  it('narrows by any of the chosen statuses, countries, cities, areas, delivery partners and sales executives — each filter one more AND term', async () => {
    const { service, listFindMany } = makeService();

    await service.list(
      query({
        status: [LogisticsStatus.DISPATCHED, LogisticsStatus.RTO],
        country: ['United Arab Emirates', 'Oman'],
        city: ['Dubai'],
        state: ['Dubai', 'Sharjah'],
        courier: ['Aramex'],
        assignedAgent: [USER],
      }),
    );

    const [args] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(args.where.AND).toEqual([
      {},
      { status: { in: ['DISPATCHED', 'RTO'] } },
      { country: { in: ['United Arab Emirates', 'Oman'] } },
      { city: { in: ['Dubai'] } },
      {},
      {},
      {},
      { state: { in: ['Dubai', 'Sharjah'] } },
      { courier: { in: ['Aramex'] } },
      // The lead's current assignees — the Leads list's own `assignedAgent` relation.
      { lead: { assignments: { some: { userId: { in: [USER] } } } } },
    ]);
  });

  it('applies the area, delivery partner and sales executive filters to the counts and the schedule as to the list', async () => {
    const { service, listFindMany, groupBy } = makeService();
    const filters = {
      state: ['Dubai'],
      courier: ['Aramex'],
      assignedAgent: [USER],
    };

    await service.list(query(filters));
    await service.summary(filters);
    await service.deliverySchedule(filters);

    const [listArgs] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    const [summaryArgs] = groupBy.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    const [scheduleArgs] = groupBy.mock.calls[1] as [
      { where: { AND: [{ AND: unknown[] }, unknown] } },
    ];
    const tail = listArgs.where.AND.slice(-3);
    expect(summaryArgs.where.AND.slice(-3)).toEqual(tail);
    expect(scheduleArgs.where.AND[0].AND.slice(-3)).toEqual(tail);
  });

  it('keeps a sales agent’s scope beside the filters, so they can only narrow it', async () => {
    const { service, listFindMany } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.list(query({ country: ['Oman'], city: ['Muscat'] }));

    const [args] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(JSON.stringify(args.where.AND[0])).toContain(`"userId":"${USER}"`);
    expect(args.where.AND).toContainEqual({ country: { in: ['Oman'] } });
    expect(args.where.AND).toContainEqual({ city: { in: ['Muscat'] } });
  });

  it('pages and sorts the filtered rows, and counts the same filtered rows', async () => {
    const { service, listFindMany, listCount } = makeService();

    await service.list(
      query({
        status: [LogisticsStatus.QC_VERIFIED],
        city: ['Dubai'],
        sort: 'customerName',
        direction: 'asc',
        page: 3,
        size: 20,
      }),
    );

    const [args] = listFindMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown; skip: number; take: number },
    ];
    expect(args).toMatchObject({
      orderBy: [{ customerName: 'asc' }, { id: 'asc' }],
      skip: 40,
      take: 20,
    });
    const [countArgs] = listCount.mock.calls[0] as [{ where: unknown }];
    expect(countArgs.where).toEqual(args.where);
  });
});

/*
  The counts above the queue are the database's, under the same scope and filters as the rows,
  so the List, the Pipeline board and the numbers can never tell different stories.
*/
describe('LogisticsOrdersService — the counts', () => {
  const group = (
    status: string,
    country: string | null,
    city: string | null,
    count: number,
    state: string | null = null,
  ) => ({ status, country, city, state, _count: { _all: count } });

  it('counts every status, country, city and area from one grouped query, zero included', async () => {
    const { service, groupBy } = makeService();
    groupBy.mockResolvedValue([
      group('INITIAL', 'United Arab Emirates', 'Dubai', 2, 'Dubai'),
      group('INITIAL', 'Oman', 'Muscat', 1, 'Muscat'),
      group('DISPATCHED', 'United Arab Emirates', 'Abu Dhabi', 2, 'Abu Dhabi'),
    ]);

    const summary = await service.summary({});

    expect(summary).toEqual({
      counts: {
        INITIAL: 3,
        QC_VERIFIED: 0,
        QC_REJECTED: 0,
        DISPATCHED: 2,
        DELIVERED: 0,
        CANCELLED: 0,
        RTO: 0,
      },
      total: 5,
      countries: [
        { value: 'United Arab Emirates', count: 4 },
        { value: 'Oman', count: 1 },
      ],
      cities: [
        { value: 'Abu Dhabi', count: 2 },
        { value: 'Dubai', count: 2 },
        { value: 'Muscat', count: 1 },
      ],
      states: [
        { value: 'Abu Dhabi', count: 2 },
        { value: 'Dubai', count: 2 },
        { value: 'Muscat', count: 1 },
      ],
      businessDay: {
        timeZone: 'Asia/Dubai',
        today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        tomorrow: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
      },
    });
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status', 'country', 'city', 'state'],
        _count: { _all: true },
      }),
    );
  });

  /*
    Logistics Dashboard v1's area-wise counts: the order's State, the Area filter's own field, so
    an area row's number is the List's total once that area is chosen.
  */
  it('counts orders per area — the same order over several statuses summed, none recorded (blank included) last — adding up to the total', async () => {
    const { service, groupBy } = makeService();
    groupBy.mockResolvedValue([
      group('INITIAL', 'United Arab Emirates', 'Dubai', 2, 'Dubai'),
      group('DELIVERED', 'United Arab Emirates', 'Deira', 3, 'Dubai'),
      group('DISPATCHED', 'United Arab Emirates', 'Al Ain', 1, 'Abu Dhabi'),
      group('RTO', 'United Arab Emirates', 'Sharjah', 1, '  '),
      group('CANCELLED', 'Oman', null, 2, null),
    ]);

    const { total, states } = await service.summary({});

    expect(states).toEqual([
      { value: 'Dubai', count: 5 },
      { value: 'Abu Dhabi', count: 1 },
      { value: null, count: 3 },
    ]);
    expect(states.reduce((sum, row) => sum + row.count, 0)).toBe(total);
  });

  it('counts areas under the same scope and filters as the list, the Area filter included', async () => {
    const { service, groupBy, listFindMany } = makeService({
      role: UserRole.SALES_MANAGER,
    });
    const filters = {
      state: ['Dubai'],
      courier: ['Aramex'],
      delivery: ['today' as const, 'overdue' as const],
      status: [LogisticsStatus.DISPATCHED],
    };

    await service.list(query(filters));
    await service.summary(filters);

    const [listArgs] = listFindMany.mock.calls[0] as [{ where: unknown }];
    const [countArgs] = groupBy.mock.calls[0] as [{ where: unknown }];
    expect(countArgs.where).toEqual(listArgs.where);
  });

  it('counts orders with no country or city, a blank one included, last — so each breakdown adds up to the total', async () => {
    const { service, groupBy } = makeService();
    groupBy.mockResolvedValue([
      group('INITIAL', null, null, 4),
      group('INITIAL', '', '  ', 1),
      group('DELIVERED', 'Oman', null, 2),
      group('RTO', 'Bahrain', 'Manama', 2),
    ]);

    const { total, countries, cities } = await service.summary({});

    expect(countries).toEqual([
      { value: 'Bahrain', count: 2 },
      { value: 'Oman', count: 2 },
      { value: null, count: 5 },
    ]);
    expect(cities).toEqual([
      { value: 'Manama', count: 2 },
      { value: null, count: 7 },
    ]);
    const sum = (rows: { count: number }[]) =>
      rows.reduce((acc, row) => acc + row.count, 0);
    expect(sum(countries)).toBe(total);
    expect(sum(cities)).toBe(total);
  });

  it('counts under exactly the list’s scope and filters, its statuses included', async () => {
    const { service, groupBy, listFindMany } = makeService({
      role: UserRole.SALES_AGENT,
    });
    const filters = {
      search: 'Acme',
      leadId: LEAD,
      status: [LogisticsStatus.DISPATCHED, LogisticsStatus.DELIVERED],
      country: ['United Arab Emirates'],
      city: ['Dubai', 'Sharjah'],
    };

    await service.list(query(filters));
    await service.summary(filters);

    const [listArgs] = listFindMany.mock.calls[0] as [{ where: unknown }];
    const [countArgs] = groupBy.mock.calls[0] as [{ where: unknown }];
    expect(countArgs.where).toEqual(listArgs.where);
    // A sales agent's counts cover their own leads' orders only.
    expect(JSON.stringify(countArgs.where)).toContain(`"userId":"${USER}"`);
  });

  /*
    The Pipeline asks for one column at a time — the list route with that column's status and
    the screen's other filters — so each column holds exactly what its count says.
  */
  it('builds a board column’s query from the same filters as the counts', async () => {
    const { service, groupBy, listFindMany } = makeService();
    const others = { country: ['Oman'], city: ['Muscat'], search: 'Acme' };

    await service.summary({ ...others, status: [LogisticsStatus.RTO] });
    await service.list(
      query({ ...others, status: [LogisticsStatus.RTO], size: 20 }),
    );

    const [countArgs] = groupBy.mock.calls[0] as [{ where: unknown }];
    const [columnArgs] = listFindMany.mock.calls[0] as [{ where: unknown }];
    expect(columnArgs.where).toEqual(countArgs.where);
  });

  it('counts only the Delivered orders for Accounts', async () => {
    const { service, groupBy, listFindMany } = makeService({
      role: UserRole.ACCOUNTS_EXECUTIVE,
    });

    await service.summary({});
    await service.list(query({ status: [LogisticsStatus.INITIAL] }));

    const [countArgs] = groupBy.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(countArgs.where.AND[0]).toEqual({ status: 'DELIVERED' });
    // A status filter can only narrow that scope: QC Pending under it matches nothing.
    const [listArgs] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(listArgs.where.AND.slice(0, 2)).toEqual([
      { status: 'DELIVERED' },
      { status: { in: ['INITIAL'] } },
    ]);
  });

  it('gives Accounts no action on a Delivered order: read-only', async () => {
    const { service } = makeService({
      role: UserRole.ACCOUNTS_EXECUTIVE,
      status: LogisticsStatus.DELIVERED,
    });

    expect((await service.get(ORDER)).allowedActions).toEqual([]);
    expect((await service.list(query())).rows[0].allowedActions).toEqual([]);
  });
});

/*
  The filter offers the values the caller's own orders hold — never a country or city that only
  orders outside their scope carry — and the whole scope, so choosing one value hides no other.
*/
describe('LogisticsOrdersService — the filter’s choices', () => {
  it('offers each country, city, state and courier once, in name order, blanks left out', async () => {
    const { service, groupBy } = makeService();
    groupBy.mockResolvedValue([
      {
        country: 'United Arab Emirates',
        city: 'Dubai',
        state: 'Dubai',
        courier: 'Aramex',
      },
      {
        country: 'United Arab Emirates',
        city: 'Abu Dhabi',
        state: 'Abu Dhabi',
        courier: null,
      },
      { country: 'Oman', city: null, state: null, courier: 'DHL' },
      { country: null, city: 'Dubai', state: 'Dubai', courier: 'Aramex' },
      { country: ' ', city: '', state: ' ', courier: '' },
    ]);

    expect(await service.filterOptions()).toEqual({
      countries: ['Oman', 'United Arab Emirates'],
      cities: ['Abu Dhabi', 'Dubai'],
      states: ['Abu Dhabi', 'Dubai'],
      couriers: ['Aramex', 'DHL'],
      assignees: [],
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ['country', 'city', 'state', 'courier'],
      where: {},
    });
  });

  it('offers as sales executives the users the orders’ leads are assigned to now, by name', async () => {
    const { service, userFindMany } = makeService({
      role: UserRole.SALES_MANAGER,
      team: 'Sales A',
    });
    userFindMany.mockResolvedValue([{ id: USER, name: 'Aisha' }]);

    expect((await service.filterOptions()).assignees).toEqual([
      { id: USER, name: 'Aisha' },
    ]);
    expect(userFindMany).toHaveBeenCalledWith({
      where: {
        assignments: {
          some: {
            lead: {
              logisticsOrder: {
                is: {
                  lead: {
                    deletedAt: null,
                    assignments: { some: { user: { team: 'Sales A' } } },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('reads a sales agent’s choices from their own leads’ orders only, and offers them only themselves', async () => {
    const { service, groupBy, userFindMany } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.filterOptions();

    const [args] = groupBy.mock.calls[0] as [{ where: unknown }];
    expect(JSON.stringify(args.where)).toContain(`"userId":"${USER}"`);
    expect(JSON.stringify(args.where)).toContain('"deletedAt":null');
    const [assignees] = userFindMany.mock.calls[0] as [
      { where: { id?: string } },
    ];
    expect(assignees.where.id).toBe(USER);
  });

  it('offers Accounts the choices of the Delivered orders only', async () => {
    const { service, groupBy, userFindMany } = makeService({
      role: UserRole.ACCOUNTS_EXECUTIVE,
    });

    await service.filterOptions();

    const [args] = groupBy.mock.calls[0] as [{ where: unknown }];
    expect(args.where).toEqual({ status: 'DELIVERED' });
    expect(JSON.stringify(userFindMany.mock.calls[0])).toContain(
      '"is":{"status":"DELIVERED"}',
    );
  });
});

/*
  Delivery dates (ADR-0094): the buckets are measured against the business day in the configured
  timezone — never the server's own zone or a browser's — and the date is set through the
  Logistics Manager's existing edit of a QC-verified order.
*/
describe('LogisticsOrdersService — delivery dates', () => {
  // 20:30 UTC on 14 Oct: already the 15th in Dubai and Muscat (UTC+4), still the 14th in Riyadh.
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    jest.setSystemTime(new Date('2026-10-14T20:30:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
  /** The delivery date's term — its buckets and its day — the last of `orderWhere`'s AND terms. */
  const DELIVERY_TERM = 6;

  it.each([
    ['Asia/Dubai', '2026-10-15', '2026-10-16'],
    ['Asia/Muscat', '2026-10-15', '2026-10-16'],
    ['Asia/Riyadh', '2026-10-14', '2026-10-15'],
  ])(
    'measures Today and Tomorrow in %s, for the list and its counts alike',
    async (timeZone, today, tomorrow) => {
      const { service, listFindMany, groupBy } = makeService({ timeZone });

      await service.list(query({ delivery: ['today', 'tomorrow'] }));
      const summary = await service.summary({
        delivery: ['today', 'tomorrow'],
      });

      const [args] = listFindMany.mock.calls[0] as [
        { where: { AND: unknown[] } },
      ];
      expect(args.where.AND[DELIVERY_TERM]).toEqual({
        OR: [{ deliveryDate: day(today) }, { deliveryDate: day(tomorrow) }],
      });
      const [countArgs] = groupBy.mock.calls[0] as [{ where: unknown }];
      expect(countArgs.where).toEqual(args.where);
      expect(summary.businessDay).toEqual({ timeZone, today, tomorrow });
    },
  );

  it('keeps Overdue to deliveries without an outcome, Future after tomorrow and None to undated orders', async () => {
    const { service, listFindMany } = makeService();

    await service.list(query({ delivery: ['overdue', 'future', 'none'] }));

    const [args] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(args.where.AND[DELIVERY_TERM]).toEqual({
      OR: [
        {
          deliveryDate: { lt: day('2026-10-15') },
          status: { notIn: ['DELIVERED', 'CANCELLED', 'RTO'] },
        },
        { deliveryDate: { gt: day('2026-10-16') } },
        { deliveryDate: null },
      ],
    });
  });

  it('adds the buckets to the status, country and city filters inside the caller’s scope', async () => {
    const { service, listFindMany } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.list(
      query({
        status: [LogisticsStatus.DISPATCHED],
        country: ['Oman'],
        city: ['Muscat'],
        delivery: ['tomorrow'],
      }),
    );

    const [args] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(JSON.stringify(args.where.AND[0])).toContain(`"userId":"${USER}"`);
    expect(args.where.AND.slice(1)).toEqual([
      { status: { in: ['DISPATCHED'] } },
      { country: { in: ['Oman'] } },
      { city: { in: ['Muscat'] } },
      {},
      {},
      { OR: [{ deliveryDate: day('2026-10-16') }] },
      {},
      {},
      {},
    ]);
  });

  it.each([
    [LogisticsStatus.QC_VERIFIED, '2026-10-16', 'tomorrow'],
    [LogisticsStatus.DISPATCHED, '2026-10-15', 'today'],
    [LogisticsStatus.DISPATCHED, '2026-10-30', 'future'],
    [LogisticsStatus.DISPATCHED, '2026-10-10', 'overdue'],
    [LogisticsStatus.QC_REJECTED, '2026-10-10', 'overdue'],
    [LogisticsStatus.DELIVERED, '2026-10-10', null],
    [LogisticsStatus.CANCELLED, '2026-10-10', null],
    [LogisticsStatus.RTO, '2026-10-10', null],
    [LogisticsStatus.DELIVERED, '2026-10-15', 'today'],
  ] as const)(
    'returns a %s order dated %s as that day, in bucket %s',
    async (status, date, bucket) => {
      const { service } = makeService({ status, deliveryDate: day(date) });

      expect(await service.get(ORDER)).toMatchObject({
        status,
        deliveryDate: date,
        deliveryBucket: bucket,
      });
    },
  );

  it('returns an undated order with no date, in No Delivery Date', async () => {
    const { service } = makeService();
    expect(await service.get(ORDER)).toMatchObject({
      deliveryDate: null,
      deliveryBucket: 'none',
    });
  });

  it('adds a chosen delivery day to the buckets as one more alternative, for the list and its counts alike', async () => {
    const { service, listFindMany, groupBy } = makeService();

    await service.list(
      query({ delivery: ['overdue'], deliveryOn: '2026-10-20' }),
    );
    await service.summary({ delivery: ['overdue'], deliveryOn: '2026-10-20' });

    const [args] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(args.where.AND[DELIVERY_TERM]).toEqual({
      OR: [
        {
          deliveryDate: { lt: day('2026-10-15') },
          status: { notIn: ['DELIVERED', 'CANCELLED', 'RTO'] },
        },
        { deliveryDate: day('2026-10-20') },
      ],
    });
    const [countArgs] = groupBy.mock.calls[0] as [{ where: unknown }];
    expect(countArgs.where).toEqual(args.where);
  });

  it('narrows to the chosen day alone when no bucket is chosen', async () => {
    const { service, listFindMany } = makeService();

    await service.list(query({ deliveryOn: '2026-10-20' }));

    const [args] = listFindMany.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(args.where.AND[DELIVERY_TERM]).toEqual({
      OR: [{ deliveryDate: day('2026-10-20') }],
    });
  });

  it('sorts by delivery date with undated orders last, in either direction', async () => {
    const { service, listFindMany } = makeService();

    await service.list(query({ sort: 'deliveryDate', direction: 'desc' }));

    const [args] = listFindMany.mock.calls[0] as [{ orderBy: unknown }];
    expect(args.orderBy).toEqual([
      { deliveryDate: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });

  it('lets the Manager set a QC-verified order’s date: written as that day, audited, the status unmoved', async () => {
    const { service, orderUpdate, orderUpdateMany, auditCreateMany } =
      makeService({ status: LogisticsStatus.QC_VERIFIED });

    const result = await service.edit(ORDER, { deliveryDate: '2026-10-20' });

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: ORDER },
      data: { deliveryDate: day('2026-10-20') },
    });
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(events(auditCreateMany)).toEqual([
      expect.objectContaining({
        action: 'UPDATED',
        before: { deliveryDate: null },
        after: { deliveryDate: '2026-10-20' },
      }),
    ]);
    expect(result).toMatchObject({
      status: LogisticsStatus.QC_VERIFIED,
      deliveryDate: '2026-10-20',
      deliveryBucket: 'future',
    });
  });

  it('changes a date the order has, and writes nothing when it is unchanged', async () => {
    const set = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      deliveryDate: day('2026-10-20'),
    });
    await set.service.edit(ORDER, { deliveryDate: '2026-10-22' });
    expect(set.orderUpdate).toHaveBeenCalledWith({
      where: { id: ORDER },
      data: { deliveryDate: day('2026-10-22') },
    });
    expect(events(set.auditCreateMany)).toEqual([
      expect.objectContaining({
        source: 'logistics.edit',
        before: { deliveryDate: '2026-10-20' },
        after: { deliveryDate: '2026-10-22' },
      }),
    ]);

    const same = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      deliveryDate: day('2026-10-20'),
    });
    await same.service.edit(ORDER, { deliveryDate: '2026-10-20' });
    expect(same.orderUpdate).not.toHaveBeenCalled();
    expect(same.auditCreateMany).not.toHaveBeenCalled();
  });

  it.each([
    LogisticsStatus.INITIAL,
    LogisticsStatus.DISPATCHED,
    LogisticsStatus.DELIVERED,
    LogisticsStatus.CANCELLED,
    LogisticsStatus.RTO,
  ])(
    'refuses a date on a %s order — the edit’s own status rule — and writes nothing',
    async (status) => {
      const { service, orderUpdate, auditCreateMany } = makeService({
        status,
      });

      await expect(
        service.edit(ORDER, { deliveryDate: '2026-10-20' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orderUpdate).not.toHaveBeenCalled();
      expect(auditCreateMany).not.toHaveBeenCalled();
    },
  );

  describe('the delivery schedule', () => {
    const group = (
      date: string | null,
      status: LogisticsStatus,
      count: number,
    ) => ({
      deliveryDate: date === null ? null : day(date),
      status,
      _count: { _all: count },
    });
    const NO_STATUS = {
      INITIAL: 0,
      QC_VERIFIED: 0,
      QC_REJECTED: 0,
      DISPATCHED: 0,
      DELIVERED: 0,
      CANCELLED: 0,
      RTO: 0,
    };

    it('counts each bucket and each of the next 14 days from one grouped query, by the filter’s own rules', async () => {
      const { service, groupBy } = makeService();
      groupBy.mockResolvedValue([
        group('2026-10-15', LogisticsStatus.QC_VERIFIED, 2),
        group('2026-10-16', LogisticsStatus.DISPATCHED, 3),
        group('2026-10-16', LogisticsStatus.DELIVERED, 1),
        group('2026-10-20', LogisticsStatus.QC_VERIFIED, 4),
        group('2026-11-30', LogisticsStatus.QC_VERIFIED, 5),
        group('2026-10-01', LogisticsStatus.DISPATCHED, 6),
        group(null, LogisticsStatus.INITIAL, 7),
        // A past delivery with an outcome is in no bucket, so it is counted nowhere.
        group('2026-10-01', LogisticsStatus.DELIVERED, 8),
      ]);

      const schedule = await service.deliverySchedule({});

      expect(schedule.businessDay).toEqual({
        timeZone: 'Asia/Dubai',
        today: '2026-10-15',
        tomorrow: '2026-10-16',
      });
      expect(schedule.buckets).toEqual({
        today: 2,
        tomorrow: 4,
        future: 9,
        overdue: 6,
        none: 7,
      });
      expect(schedule.days.map((each) => each.date)).toEqual(
        Array.from({ length: 14 }, (_, index) => `2026-10-${15 + index}`),
      );
      expect(schedule.days.map((each) => each.total)).toEqual([
        2, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
      expect(schedule.days[1]).toEqual({
        date: '2026-10-16',
        total: 4,
        counts: { ...NO_STATUS, DISPATCHED: 3, DELIVERED: 1 },
      });

      const [args] = groupBy.mock.calls[0] as [
        { by: unknown; where: { AND: unknown[] } },
      ];
      expect(args.by).toEqual(['deliveryDate', 'status']);
      expect(args.where.AND[1]).toEqual({
        OR: [
          { deliveryDate: day('2026-10-15') },
          { deliveryDate: day('2026-10-16') },
          { deliveryDate: { gt: day('2026-10-16') } },
          {
            deliveryDate: { lt: day('2026-10-15') },
            status: { notIn: ['DELIVERED', 'CANCELLED', 'RTO'] },
          },
          { deliveryDate: null },
        ],
      });
    });

    it('ignores the delivery bucket and day chosen, and keeps every other filter inside the caller’s scope', async () => {
      const { service, groupBy } = makeService({ role: UserRole.SALES_AGENT });

      await service.deliverySchedule({
        status: [LogisticsStatus.DISPATCHED],
        country: ['Oman'],
        city: ['Muscat'],
        search: 'Noor',
        delivery: ['today'],
        deliveryOn: '2026-10-20',
      });

      const [args] = groupBy.mock.calls[0] as [
        { where: { AND: [{ AND: unknown[] }, unknown] } },
      ];
      const terms = args.where.AND[0].AND;
      expect(JSON.stringify(terms[0])).toContain(`"userId":"${USER}"`);
      expect(terms.slice(1, 4)).toEqual([
        { status: { in: ['DISPATCHED'] } },
        { country: { in: ['Oman'] } },
        { city: { in: ['Muscat'] } },
      ]);
      expect(terms[SEARCH_TERM]).not.toEqual({});
      expect(terms[DELIVERY_TERM]).toEqual({});
    });

    it.each([
      ['Asia/Dubai', '2026-10-15', '2026-10-28'],
      ['Asia/Muscat', '2026-10-15', '2026-10-28'],
      ['Asia/Riyadh', '2026-10-14', '2026-10-27'],
    ])(
      'starts the days at the business day’s today in %s',
      async (timeZone, first, last) => {
        const { service } = makeService({ timeZone });

        const schedule = await service.deliverySchedule({});

        expect(schedule.businessDay.today).toBe(first);
        expect(schedule.days[0].date).toBe(first);
        expect(schedule.days.at(-1)?.date).toBe(last);
      },
    );

    it('runs the days across a month end on the calendar', async () => {
      jest.setSystemTime(new Date('2026-10-25T08:00:00.000Z'));
      const { service } = makeService();

      const schedule = await service.deliverySchedule({});

      expect(schedule.days.slice(5, 9).map((each) => each.date)).toEqual([
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
        '2026-11-02',
      ]);
    });

    it('returns every bucket and every day, each status at zero, when nothing matches', async () => {
      const { service } = makeService();

      const schedule = await service.deliverySchedule({});

      expect(schedule.buckets).toEqual({
        today: 0,
        tomorrow: 0,
        future: 0,
        overdue: 0,
        none: 0,
      });
      expect(schedule.days).toHaveLength(14);
      for (const each of schedule.days) {
        expect(each).toEqual({ date: each.date, total: 0, counts: NO_STATUS });
      }
    });
  });
});

/*
  Phase 2D (ADR-0094): Sales sets or changes the delivery date the customer asked for until QC
  verifies the order — never clears it: every order must have one (client, 2026-10-17). The provisional defaults it rests on — who (P1), until when (P2), never a
  past day (P4), in the business timezone (P5) — are each pinned here.
*/
describe('LogisticsOrdersService — the Sales delivery date (Phase 2D)', () => {
  // 20:30 UTC on 14 Oct: already the 15th in Dubai and Muscat (UTC+4), still the 14th in Riyadh.
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    jest.setSystemTime(new Date('2026-10-14T20:30:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
  const set = (deliveryDate: string): SetDeliveryDateDto => ({
    deliveryDate,
  });

  it.each([
    [UserRole.SALES_AGENT, LogisticsStatus.INITIAL],
    [UserRole.SALES_AGENT, LogisticsStatus.QC_REJECTED],
    [UserRole.SALES_MANAGER, LogisticsStatus.INITIAL],
    [UserRole.SALES_MANAGER, LogisticsStatus.QC_REJECTED],
    [UserRole.SUPERADMIN, LogisticsStatus.INITIAL],
    [UserRole.SUPERADMIN, LogisticsStatus.QC_REJECTED],
  ])(
    'lets a %s set the date of a %s order, audited before and after, and nothing else changes',
    async (role, status) => {
      const {
        service,
        order,
        orderUpdate,
        orderUpdateMany,
        leadUpdate,
        auditCreateMany,
      } = makeService({ role, status });

      const result = await service.setDeliveryDate(ORDER, set('2026-10-20'));

      expect(orderUpdate).toHaveBeenCalledWith({
        where: { id: ORDER },
        data: { deliveryDate: day('2026-10-20') },
      });
      expect(result.deliveryDate).toBe('2026-10-20');
      expect(result.deliveryBucket).toBe('future');
      // The date is the only write: the status never moves and the lead is not touched.
      expect(order.status).toBe(status);
      expect(result.status).toBe(status);
      expect(orderUpdateMany).not.toHaveBeenCalled();
      expect(leadUpdate).not.toHaveBeenCalled();
      expect(events(auditCreateMany)).toEqual([
        expect.objectContaining({
          entityType: 'LOGISTICS_ORDER',
          entityId: ORDER,
          leadId: LEAD,
          action: 'UPDATED',
          actorType: 'USER',
          actorId: USER,
          source: 'logistics.delivery_date',
          before: { deliveryDate: null },
          after: { deliveryDate: '2026-10-20' },
        }),
      ]);
    },
  );

  it('changes a date it already has, recording the day it replaced', async () => {
    const { service, auditCreateMany } = makeService({
      role: UserRole.SALES_AGENT,
      deliveryDate: day('2026-10-18'),
    });

    const result = await service.setDeliveryDate(ORDER, set('2026-10-22'));

    expect(result.deliveryDate).toBe('2026-10-22');
    expect(events(auditCreateMany)).toEqual([
      expect.objectContaining({
        before: { deliveryDate: '2026-10-18' },
        after: { deliveryDate: '2026-10-22' },
      }),
    ]);
  });

  it('writes nothing and records nothing for the date it already has', async () => {
    const { service, orderUpdate, auditCreateMany } = makeService({
      role: UserRole.SALES_AGENT,
      deliveryDate: day('2026-10-18'),
    });

    const result = await service.setDeliveryDate(ORDER, set('2026-10-18'));

    expect(result.deliveryDate).toBe('2026-10-18');
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(events(auditCreateMany)).toEqual([]);
  });

  it('refuses a value that is not a real day even if a caller skips the DTO, writing nothing', async () => {
    const { service, orderUpdate, auditCreateMany } = makeService({
      role: UserRole.SALES_AGENT,
      deliveryDate: day('2026-10-18'),
    });

    const attempt = service.setDeliveryDate(ORDER, set('2026-02-30'));

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(
      'Delivery Date must be a real date written YYYY-MM-DD (years 2000-2099)',
    );
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(events(auditCreateMany)).toEqual([]);
  });

  it('refuses a day before the business day’s today with a 400, and accepts today itself (P4)', async () => {
    const past = makeService({ role: UserRole.SALES_AGENT });
    const attempt = past.service.setDeliveryDate(ORDER, set('2026-10-14'));
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(
      'The delivery date can’t be before today, 15-10-2026 (Asia/Dubai).',
    );
    expect(past.orderUpdate).not.toHaveBeenCalled();
    expect(events(past.auditCreateMany)).toEqual([]);

    const today = makeService({ role: UserRole.SALES_AGENT });
    await expect(
      today.service.setDeliveryDate(ORDER, set('2026-10-15')),
    ).resolves.toMatchObject({
      deliveryDate: '2026-10-15',
      deliveryBucket: 'today',
    });
  });

  it.each([
    ['Asia/Dubai', false],
    ['Asia/Muscat', false],
    ['Asia/Riyadh', true],
  ])(
    'at 20:30 UTC on 14 Oct, under %s, the 14th is still a day Sales may choose: %s (P5)',
    async (timeZone, accepted) => {
      const { service, orderUpdate } = makeService({
        role: UserRole.SALES_AGENT,
        timeZone,
      });

      const attempt = service.setDeliveryDate(ORDER, set('2026-10-14'));

      if (accepted) {
        await expect(attempt).resolves.toMatchObject({
          deliveryDate: '2026-10-14',
          deliveryBucket: 'today',
        });
      } else {
        await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
        expect(orderUpdate).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    LogisticsStatus.QC_VERIFIED,
    LogisticsStatus.DISPATCHED,
    LogisticsStatus.DELIVERED,
    LogisticsStatus.CANCELLED,
    LogisticsStatus.RTO,
  ])(
    'refuses the date of a %s order with a 409 naming its status, whoever asks (P2)',
    async (status) => {
      for (const role of [
        UserRole.SALES_AGENT,
        UserRole.SALES_MANAGER,
        UserRole.SUPERADMIN,
      ]) {
        const { service, orderUpdate, auditCreateMany } = makeService({
          role,
          status,
        });

        const attempt = service.setDeliveryDate(ORDER, set('2026-10-20'));

        await expect(attempt).rejects.toBeInstanceOf(ConflictException);
        await expect(attempt).rejects.toThrow(
          `This order is ${status}; its delivery date can only be set while INITIAL or QC_REJECTED.`,
        );
        expect(orderUpdate).not.toHaveBeenCalled();
        expect(events(auditCreateMany)).toEqual([]);
      }
    },
  );

  it('leaves a QC-verified order’s date to the Manager’s edit, which may still correct it to a past day', async () => {
    const { service, auditCreateMany } = makeService({
      role: UserRole.LOGISTICS_MANAGER,
      status: LogisticsStatus.QC_VERIFIED,
    });

    const result = await service.edit(ORDER, { deliveryDate: '2026-10-01' });

    expect(result.deliveryDate).toBe('2026-10-01');
    expect(result.status).toBe(LogisticsStatus.QC_VERIFIED);
    expect(events(auditCreateMany)).toEqual([
      expect.objectContaining({
        source: 'logistics.edit',
        before: { deliveryDate: null },
        after: { deliveryDate: '2026-10-01' },
      }),
    ]);
  });

  it.each([UserRole.SALES_AGENT, UserRole.SALES_MANAGER])(
    'gives a %s an order outside their scope as a 404, and writes nothing',
    async (role) => {
      const { service, orderUpdate, auditCreateMany } = makeService({
        role,
        inScope: false,
      });

      await expect(
        service.setDeliveryDate(ORDER, set('2026-10-20')),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(orderUpdate).not.toHaveBeenCalled();
      expect(events(auditCreateMany)).toEqual([]);
    },
  );

  it('reads the order through the caller’s lead scope: an agent’s own leads, a manager’s team', async () => {
    const agent = makeService({ role: UserRole.SALES_AGENT });
    const manager = makeService({
      role: UserRole.SALES_MANAGER,
      team: 'Sales A',
    });

    await agent.service.setDeliveryDate(ORDER, set('2026-10-20'));
    await manager.service.setDeliveryDate(ORDER, set('2026-10-20'));

    const scopeOf = (findFirst: jest.Mock) =>
      (findFirst.mock.calls[0] as [{ where: { AND: unknown[] } }])[0].where
        .AND[0];
    expect(scopeOf(agent.orderFindFirst)).toEqual({
      lead: { deletedAt: null, assignments: { some: { userId: USER } } },
    });
    // Another team's lead matches nothing here, so its order is the 404 above.
    expect(scopeOf(manager.orderFindFirst)).toEqual({
      lead: {
        deletedAt: null,
        assignments: { some: { user: { team: 'Sales A' } } },
      },
    });
  });

  it('refuses a view-only agent — their lead sits in a pipeline closed to them — with a 403 in any status, and does not offer the date', async () => {
    for (const status of [
      LogisticsStatus.INITIAL,
      LogisticsStatus.QC_VERIFIED,
    ]) {
      const { service, orderUpdate, auditCreateMany } = makeService({
        role: UserRole.SALES_AGENT,
        status,
        deniedPipelines: ['VIP Pipeline'],
        leadPipeline: 'VIP Pipeline',
      });

      await expect(
        service.setDeliveryDate(ORDER, set('2026-10-20')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(orderUpdate).not.toHaveBeenCalled();
      expect(events(auditCreateMany)).toEqual([]);
      // The assignment still lets them read the order, without the action.
      expect((await service.get(ORDER)).allowedActions).toEqual([]);
      expect((await service.list(query())).rows[0].allowedActions).toEqual([]);
    }
  });

  it('still offers and takes the date when only another pipeline is closed to the agent', async () => {
    const { service } = makeService({
      role: UserRole.SALES_AGENT,
      deniedPipelines: ['VIP Pipeline'],
    });

    expect((await service.get(ORDER)).allowedActions).toEqual([
      'SET_DELIVERY_DATE',
    ]);
    await expect(
      service.setDeliveryDate(ORDER, set('2026-10-20')),
    ).resolves.toMatchObject({
      deliveryDate: '2026-10-20',
      allowedActions: ['SET_DELIVERY_DATE'],
    });
  });

  it('locks the order row before reading it, and reads it before writing', async () => {
    const { service, queryRaw, orderFindFirst, orderUpdate } = makeService({
      role: UserRole.SALES_AGENT,
    });

    await service.setDeliveryDate(ORDER, set('2026-10-20'));

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, id] = queryRaw.mock.calls[0] as [string[], string];
    expect(strings.join('?')).toContain('FOR UPDATE');
    expect(id).toBe(ORDER);
    const [lock] = queryRaw.mock.invocationCallOrder;
    const [read] = orderFindFirst.mock.invocationCallOrder;
    const [write] = orderUpdate.mock.invocationCallOrder;
    expect(lock).toBeLessThan(read);
    expect(read).toBeLessThan(write);
  });

  it('keeps one order and its date through a QC rejection, a Sales change and the resubmit', async () => {
    const kit = makeService({ role: UserRole.SALES_AGENT });

    await kit.service.setDeliveryDate(ORDER, set('2026-10-20'));
    kit.as(UserRole.QC);
    await kit.service.qcReject(ORDER, { remarks: 'Wrong address' });
    kit.as(UserRole.SALES_AGENT);
    await kit.service.setDeliveryDate(ORDER, set('2026-10-22'));
    kit.as(UserRole.SALES_MANAGER);
    const result = await kit.service.resubmit(ORDER, {});

    expect(result).toMatchObject({
      id: ORDER,
      status: LogisticsStatus.INITIAL,
      deliveryDate: '2026-10-22',
    });
    // The lead became WON again; the conversion's insert skipped it, so no second order.
    expect(kit.createManyAndReturn).toHaveBeenCalledTimes(1);
    const [insert] = kit.createManyAndReturn.mock.calls[0] as [unknown];
    expect(insert).toMatchObject({ skipDuplicates: true });
    expect(
      events(kit.auditCreateMany)
        .filter((event) => event.entityType === 'LOGISTICS_ORDER')
        .map((event) => [event.action, event.after]),
    ).toEqual([
      ['UPDATED', { deliveryDate: '2026-10-20' }],
      ['QC_REJECTED', { status: LogisticsStatus.QC_REJECTED }],
      ['UPDATED', { deliveryDate: '2026-10-22' }],
      ['RESUBMITTED', { status: LogisticsStatus.INITIAL }],
    ]);
  });

  it('puts an order dated for tomorrow while QC Pending into the schedule’s Tomorrow, its day and its QC Pending count (P8)', async () => {
    const { service, groupBy } = makeService({ role: UserRole.SALES_AGENT });

    const dated = await service.setDeliveryDate(ORDER, set('2026-10-16'));
    // The schedule's grouped query, as the database now answers it for this order.
    groupBy.mockResolvedValue([
      {
        deliveryDate: day('2026-10-16'),
        status: LogisticsStatus.INITIAL,
        _count: { _all: 1 },
      },
    ]);
    const schedule = await service.deliverySchedule({});

    expect(dated.deliveryBucket).toBe('tomorrow');
    expect(schedule.buckets).toMatchObject({ tomorrow: 1, today: 0, none: 0 });
    expect(schedule.days[1]).toEqual({
      date: '2026-10-16',
      total: 1,
      counts: expect.objectContaining({ INITIAL: 1 }) as unknown,
    });
  });
});

/*
  A QC verification and a Sales date racing on one order. Postgres' row lock is modelled: the
  date's `SELECT … FOR UPDATE` and QC's conditional UPDATE both take it, and it is held until
  the transaction ends, so whichever comes second waits. A transaction can be held open at a
  chosen point, still holding the lock, to interleave the two exactly.
*/
function lockedOrder(deliveryDate?: Date) {
  const { order } = makeService({ deliveryDate });
  const audit: Record<string, unknown>[] = [];
  const pauses = new Map<string, Promise<void>>();
  let holder: object | null = null;
  let waiting: (() => void)[] = [];

  const acquire = async (owner: object) => {
    while (holder !== null && holder !== owner) {
      await new Promise<void>((wake) => waiting.push(wake));
    }
    holder = owner;
  };
  const release = (owner: object) => {
    if (holder !== owner) return;
    holder = null;
    const woken = waiting;
    waiting = [];
    woken.forEach((wake) => wake());
  };
  const pauseIfAsked = async (point: string) => {
    const pause = pauses.get(point);
    if (pause) {
      pauses.delete(point);
      await pause;
    }
  };

  const txFor = (owner: object) => ({
    $queryRaw: async () => {
      await acquire(owner);
      return [];
    },
    logisticsOrder: {
      findFirst: () => Promise.resolve({ ...order }),
      findUnique: () => Promise.resolve({ ...order }),
      update: async (args: { data: Record<string, unknown> }) => {
        await acquire(owner);
        Object.assign(order, args.data);
        return { id: ORDER };
      },
      updateMany: async (args: {
        where: { status: LogisticsStatus };
        data: Record<string, unknown>;
      }) => {
        await acquire(owner);
        if (args.where.status !== order.status) return { count: 0 };
        Object.assign(order, args.data);
        await pauseIfAsked('moved');
        return { count: 1 };
      },
    },
    lead: {
      findUniqueOrThrow: async () => {
        await pauseIfAsked('locked');
        return { pipeline: 'Lead Pipeline' };
      },
      findMany: () => Promise.resolve([]),
    },
    auditEvent: {
      createMany: (args: { data: Record<string, unknown>[] }) => {
        audit.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      },
    },
  });

  const prisma = {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const owner = {};
      try {
        return await callback(txFor(owner));
      } finally {
        release(owner);
      }
    },
  } as unknown as PrismaService;
  const config = {
    getOrThrow: () => ({ businessTimeZone: 'Asia/Dubai' }),
  } as unknown as ConfigService;
  const serviceFor = (role: UserRole) =>
    new LogisticsOrdersService(
      prisma,
      { resolve: () => Promise.resolve({ id: USER, role, team: null }) },
      config,
    );
  /** Holds the next transaction to reach `point` there, lock and all, until the returned call. */
  const pauseAt = (point: 'locked' | 'moved') => {
    let open!: () => void;
    pauses.set(point, new Promise<void>((resolve) => (open = resolve)));
    return () => open();
  };
  return { order, audit, serviceFor, pauseAt };
}

/** Lets every pending callback run, so a waiting transaction shows that it is waiting. */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe('LogisticsOrdersService — a QC verification racing the Sales date', () => {
  it('makes a verification that arrives while the date is being changed wait, then verify the order with the new date', async () => {
    const { order, audit, serviceFor, pauseAt } = lockedOrder(DATED);
    const resume = pauseAt('locked');

    const dating = serviceFor(UserRole.SALES_AGENT).setDeliveryDate(ORDER, {
      deliveryDate: '2099-01-15',
    });
    await settle();
    let verified = false;
    const verifying = serviceFor(UserRole.QC)
      .qcVerify(ORDER, {})
      .then((result) => {
        verified = true;
        return result;
      });
    await settle();

    // QC's update is waiting on the lock the date holds: nothing has moved yet.
    expect(verified).toBe(false);
    expect(order.status).toBe(LogisticsStatus.INITIAL);

    resume();
    await expect(dating).resolves.toMatchObject({
      deliveryDate: '2099-01-15',
    });
    await expect(verifying).resolves.toMatchObject({
      status: LogisticsStatus.QC_VERIFIED,
      deliveryDate: '2099-01-15',
    });
    expect(audit.map((event) => event.action)).toEqual([
      'UPDATED',
      'QC_VERIFIED',
    ]);
  });

  it('refuses the date with a 409 once a verification that took the lock first commits', async () => {
    const { order, audit, serviceFor, pauseAt } = lockedOrder(DATED);
    const resume = pauseAt('moved');

    const verifying = serviceFor(UserRole.QC).qcVerify(ORDER, {});
    await settle();
    const dating = serviceFor(UserRole.SALES_AGENT).setDeliveryDate(ORDER, {
      deliveryDate: '2099-01-15',
    });
    await settle();

    resume();
    await expect(verifying).resolves.toMatchObject({
      status: LogisticsStatus.QC_VERIFIED,
    });
    await expect(dating).rejects.toBeInstanceOf(ConflictException);
    expect(order.deliveryDate).toEqual(DATED);
    expect(audit.map((event) => event.action)).toEqual(['QC_VERIFIED']);
  });

  it('refuses a verification that reads the order still undated while its first date is being set — and the date still lands', async () => {
    const { order, audit, serviceFor, pauseAt } = lockedOrder();
    const resume = pauseAt('locked');

    const dating = serviceFor(UserRole.SALES_AGENT).setDeliveryDate(ORDER, {
      deliveryDate: '2099-01-15',
    });
    await settle();
    const verifying = serviceFor(UserRole.QC).qcVerify(ORDER, {});

    await expect(verifying).rejects.toThrow(
      'This order has no delivery date. Set one before QC verification.',
    );
    resume();
    await expect(dating).resolves.toMatchObject({
      status: LogisticsStatus.INITIAL,
      deliveryDate: '2099-01-15',
    });
    expect(order.status).toBe(LogisticsStatus.INITIAL);
    expect(audit.map((event) => event.action)).toEqual(['UPDATED']);
  });
});

/*
  Every order must have a delivery date (client, 2026-10-17): QC does not verify an undated order
  and Logistics does not dispatch one. The service refuses both with a 409 — the UI hiding them is
  only advice — and nothing else asks for a date.
*/
describe('LogisticsOrdersService — a delivery date before QC verification and dispatch', () => {
  it.each([
    [
      'QC verification',
      LogisticsStatus.INITIAL,
      UserRole.QC,
      (service: LogisticsOrdersService) => service.qcVerify(ORDER, {}),
      'This order has no delivery date. Set one before QC verification.',
    ],
    [
      'dispatch',
      LogisticsStatus.QC_VERIFIED,
      UserRole.LOGISTICS_EXECUTIVE,
      (service: LogisticsOrdersService) =>
        service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
      'This order has no delivery date. Set one before dispatch.',
    ],
  ] as const)(
    'refuses %s of an undated order with a 409, and moves and records nothing',
    async (_label, status, role, act, message) => {
      const { service, order, orderUpdateMany, auditCreateMany } = makeService({
        status,
        role,
      });

      const attempt = act(service);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(message);
      expect(order.status).toBe(status);
      expect(orderUpdateMany).not.toHaveBeenCalled();
      expect(auditCreateMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'QC verification',
      LogisticsStatus.INITIAL,
      UserRole.QC,
      (service: LogisticsOrdersService) => service.qcVerify(ORDER, {}),
      LogisticsStatus.QC_VERIFIED,
    ],
    [
      'dispatch',
      LogisticsStatus.QC_VERIFIED,
      UserRole.LOGISTICS_MANAGER,
      (service: LogisticsOrdersService) =>
        service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
      LogisticsStatus.DISPATCHED,
    ],
  ] as const)(
    'lets %s of a dated order through as before',
    async (_label, status, role, act, reached) => {
      const { service, order } = makeService({
        status,
        role,
        deliveryDate: DATED,
      });

      await expect(act(service)).resolves.toMatchObject({ status: reached });
      expect(order.status).toBe(reached);
    },
  );

  it('keeps the status refusal for a move the status does not allow, dated or not', async () => {
    const { service } = makeService({
      status: LogisticsStatus.DISPATCHED,
      role: UserRole.QC,
    });

    await expect(service.qcVerify(ORDER, {})).rejects.toThrow(
      'This order is DISPATCHED; it cannot be moved to QC_VERIFIED.',
    );
  });

  it('asks for the date before it looks up the AWB', async () => {
    const { service, orderFindFirst } = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      role: UserRole.LOGISTICS_MANAGER,
      awbHolder: { awbNumber: 'AWB-1', orderNumber: 1000 },
    });

    await expect(
      service.dispatch(ORDER, { awbNumber: 'AWB-1' }),
    ).rejects.toThrow('Set one before dispatch.');
    const lookups = (orderFindFirst.mock.calls as [{ where: object }][]).map(
      ([args]) => JSON.stringify(args.where),
    );
    expect(lookups.some((where) => where.includes('awbNumber'))).toBe(false);
  });

  it.each([
    [
      'QC rejection',
      LogisticsStatus.INITIAL,
      UserRole.QC,
      (service: LogisticsOrdersService) =>
        service.qcReject(ORDER, { remarks: 'Wrong address' }),
      LogisticsStatus.QC_REJECTED,
    ],
    [
      'resubmission',
      LogisticsStatus.QC_REJECTED,
      UserRole.SALES_MANAGER,
      (service: LogisticsOrdersService) => service.resubmit(ORDER, {}),
      LogisticsStatus.INITIAL,
    ],
    [
      'delivery',
      LogisticsStatus.DISPATCHED,
      UserRole.LOGISTICS_EXECUTIVE,
      (service: LogisticsOrdersService) => service.deliver(ORDER),
      LogisticsStatus.DELIVERED,
    ],
    [
      'cancellation',
      LogisticsStatus.DISPATCHED,
      UserRole.LOGISTICS_EXECUTIVE,
      (service: LogisticsOrdersService) =>
        service.cancel(ORDER, { reason: 'Customer refused' }),
      LogisticsStatus.CANCELLED,
    ],
    [
      'RTO',
      LogisticsStatus.DISPATCHED,
      UserRole.LOGISTICS_MANAGER,
      (service: LogisticsOrdersService) =>
        service.rto(ORDER, { reason: 'Address not found' }),
      LogisticsStatus.RTO,
    ],
  ] as const)(
    'asks no date for %s: an undated order still moves',
    async (_label, status, role, act, reached) => {
      const { service, order } = makeService({
        status,
        role,
        leadStatus:
          status === LogisticsStatus.QC_REJECTED ? 'QC NOT APPROVED' : 'WON',
      });

      await act(service);

      expect(order.status).toBe(reached);
    },
  );

  it.each([
    [
      UserRole.QC,
      LogisticsStatus.INITIAL,
      ['QC_VERIFY', 'QC_REJECT'],
      ['QC_REJECT'],
    ],
    [
      UserRole.LOGISTICS_MANAGER,
      LogisticsStatus.QC_VERIFIED,
      ['DISPATCH', 'EDIT', 'CORRECT_DELIVERY_DATE'],
      ['EDIT', 'CORRECT_DELIVERY_DATE'],
    ],
    [
      UserRole.LOGISTICS_EXECUTIVE,
      LogisticsStatus.QC_VERIFIED,
      ['DISPATCH', 'CORRECT_DELIVERY_DATE'],
      ['CORRECT_DELIVERY_DATE'],
    ],
  ] as const)(
    'offers a %s on a %s order %j when dated, and %j while undated',
    async (role, status, dated, undated) => {
      const withDate = makeService({ role, status, deliveryDate: DATED });
      const without = makeService({ role, status });

      expect((await withDate.service.get(ORDER)).allowedActions).toEqual(dated);
      expect((await without.service.get(ORDER)).allowedActions).toEqual(
        undated,
      );
    },
  );
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
      'CORRECT_DELIVERY_DATE',
    ]);
  });

  it('gives a sales agent reading the list the delivery date until QC verifies the order, and nothing more', async () => {
    const rejected = makeService({
      status: LogisticsStatus.QC_REJECTED,
      role: UserRole.SALES_AGENT,
    });
    const verified = makeService({
      status: LogisticsStatus.QC_VERIFIED,
      role: UserRole.SALES_AGENT,
    });

    const { rows } = await rejected.service.list(query());
    const later = await verified.service.list(query());

    expect(rows[0].allowedActions).toEqual(['SET_DELIVERY_DATE']);
    expect(later.rows[0].allowedActions).toEqual([]);
  });

  it('answers a transition with the actions of the status it just reached', async () => {
    const { service } = makeService({
      deliveryDate: DATED,
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

  it('takes the Sales delivery date as a day', async () => {
    const dto = plainToInstance(SetDeliveryDateDto, {
      deliveryDate: '2026-10-20',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.deliveryDate).toBe('2026-10-20');
  });

  it.each([
    {},
    { deliveryDate: null },
    { deliveryDate: '' },
    { deliveryDate: '  ' },
  ])(
    'refuses the Sales delivery date %j as a clear — every order must have one',
    async (body) => {
      const errors = await validate(plainToInstance(SetDeliveryDateDto, body));
      expect(errors.map((error) => error.property)).toEqual(['deliveryDate']);
      expect(Object.values(errors[0].constraints ?? {})).toEqual([
        'Delivery Date is required; an order’s delivery date can’t be cleared',
      ]);
    },
  );

  it.each([
    { deliveryDate: '2026-02-30' },
    { deliveryDate: '15-10-2026' },
    { deliveryDate: '2026-10-15T00:00:00.000Z' },
    { deliveryDate: '1999-12-31' },
    { deliveryDate: 20261015 },
  ])('refuses the Sales delivery date %j', async (body) => {
    expect(await invalid(SetDeliveryDateDto, body)).toEqual(['deliveryDate']);
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

  it.each(['awbNumber', 'id', 'convertedAt; DROP TABLE logistics_orders', ''])(
    'refuses sorting by %j — only the whitelisted columns',
    async (sort) => {
      expect(await invalid(ListLogisticsOrdersDto, { sort })).toEqual(['sort']);
    },
  );

  it('sorts newest first unless told otherwise, and reads the direction in any case', async () => {
    expect(plainToInstance(ListLogisticsOrdersDto, {})).toMatchObject({
      sort: 'convertedAt',
      direction: 'desc',
    });
    const dto = plainToInstance(ListLogisticsOrdersDto, {
      sort: 'orderNumber',
      direction: 'ASC',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ sort: 'orderNumber', direction: 'asc' });
    expect(
      await invalid(ListLogisticsOrdersDto, { direction: 'sideways' }),
    ).toEqual(['direction']);
  });

  /*
    The platform's list search limit, which the frontend's search box also stops at — a term the
    box allows can never come back as a 400.
  */
  it.each([
    ['the list', ListLogisticsOrdersDto],
    ['the counts', LogisticsOrderFiltersDto],
  ] as const)(
    'takes a search of up to 200 characters for %s',
    async (_label, dto) => {
      expect(await invalid(dto, { search: 'a'.repeat(200) })).toEqual([]);
      expect(await invalid(dto, { search: 'a'.repeat(201) })).toEqual([
        'search',
      ]);
    },
  );

  /*
    The list and its counts take the same filters, read the way the Leads list reads its own:
    `?status=A&status=B`, a single value, or a blank one, which is no filter at all.
  */
  describe.each([
    ['the list', ListLogisticsOrdersDto],
    ['the counts', LogisticsOrderFiltersDto],
  ] as const)('the filters of %s', (_label, dto) => {
    it('reads one value or several, trimmed, and a blank one as no filter', async () => {
      const parsed = plainToInstance(dto, {
        status: 'DISPATCHED',
        country: [' Oman ', 'United Arab Emirates'],
        city: ['', '  '],
      });
      expect(await validate(parsed)).toEqual([]);
      expect(parsed).toMatchObject({
        status: ['DISPATCHED'],
        country: ['Oman', 'United Arab Emirates'],
      });
      expect(parsed.city).toBeUndefined();
    });

    it.each([
      { status: 'SHIPPED' },
      { status: ['DISPATCHED', 'dispatched'] },
      { country: 'a'.repeat(65) },
      { city: 'a'.repeat(121) },
      { city: Array.from({ length: 101 }, (_, i) => `City ${i}`) },
      { delivery: 'someday' },
      { delivery: ['today', 'Today'] },
      { deliveryOn: '2026-02-30' },
      { deliveryOn: '15-10-2026' },
      { deliveryOn: '2026-10-15T00:00:00.000Z' },
      { deliveryOn: ['2026-10-15', '2026-10-16'] },
      { deliveryOn: '' },
    ])('refuses %j', async (body) => {
      expect(await invalid(dto, body)).toEqual(Object.keys(body));
    });

    it('reads one delivery day, written YYYY-MM-DD', async () => {
      const parsed = plainToInstance(dto, { deliveryOn: '2026-10-20' });
      expect(await validate(parsed)).toEqual([]);
      expect(parsed.deliveryOn).toBe('2026-10-20');
    });

    it('takes a country and a city as long as their columns', async () => {
      expect(
        await invalid(dto, {
          country: 'a'.repeat(64),
          city: 'a'.repeat(120),
          status: Object.values(LogisticsStatus),
        }),
      ).toEqual([]);
    });

    it('reads one delivery bucket or several', async () => {
      const one = plainToInstance(dto, { delivery: 'tomorrow' });
      const all = plainToInstance(dto, {
        delivery: ['today', 'tomorrow', 'future', 'overdue', 'none'],
      });
      expect([await validate(one), await validate(all)]).toEqual([[], []]);
      expect(one.delivery).toEqual(['tomorrow']);
    });
  });

  /*
    A delivery date is a calendar day written YYYY-MM-DD: a date-time, another layout or an
    impossible day is refused before it can reach the column, so nothing is shifted or rolled
    over (2026-02-30 is not quietly 2 March).
  */
  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-2-3',
    '15-10-2026',
    '2026-10-15T00:00:00.000Z',
    '1999-12-31',
    '2100-01-01',
    'tomorrow',
    20261015,
  ])('refuses the delivery date %j', async (deliveryDate) => {
    expect(await invalid(UpdateLogisticsOrderDto, { deliveryDate })).toEqual([
      'deliveryDate',
    ]);
  });

  it.each(['2026-10-15', '2028-02-29', '2000-01-01', '2099-12-31'])(
    'accepts the delivery date %j',
    async (deliveryDate) => {
      expect(await invalid(UpdateLogisticsOrderDto, { deliveryDate })).toEqual(
        [],
      );
    },
  );

  it.each([null, '', '  '])(
    'refuses clearing the delivery date in the Manager’s edit (%j)',
    async (deliveryDate) => {
      const errors = await validate(
        plainToInstance(UpdateLogisticsOrderDto, { deliveryDate }),
      );
      expect(errors.map((error) => error.property)).toEqual(['deliveryDate']);
      expect(Object.values(errors[0].constraints ?? {})).toEqual([
        'Delivery Date is required; an order’s delivery date can’t be cleared',
      ]);
    },
  );

  it('leaves the delivery date alone when the Manager’s edit does not send it', async () => {
    expect(
      await invalid(UpdateLogisticsOrderDto, { city: 'Abu Dhabi' }),
    ).toEqual([]);
  });

  it('sorts by delivery date, still from the whitelist', async () => {
    expect(
      await invalid(ListLogisticsOrdersDto, { sort: 'deliveryDate' }),
    ).toEqual([]);
  });
});

/*
  The Logistics team corrects the delivery date once QC has verified the order (client,
  2026-10-17): both Logistics roles and Super Admin, on QC Verified and Dispatched orders, today
  or later in the business timezone, never cleared, always with a reason — recorded as the order's
  UPDATED event with its own source, so the Journey tells it from Sales' date and the Manager's edit.
*/
describe('LogisticsOrdersService — the Logistics delivery-date correction', () => {
  // 20:30 UTC on 14 Oct: already the 15th in Dubai.
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    jest.setSystemTime(new Date('2026-10-14T20:30:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
  const correct = (
    deliveryDate: string,
    reason = 'Customer asked to move it',
  ): CorrectDeliveryDateDto => ({ deliveryDate, reason });

  it.each([
    [UserRole.LOGISTICS_MANAGER, LogisticsStatus.QC_VERIFIED],
    [UserRole.LOGISTICS_MANAGER, LogisticsStatus.DISPATCHED],
    [UserRole.LOGISTICS_EXECUTIVE, LogisticsStatus.QC_VERIFIED],
    [UserRole.LOGISTICS_EXECUTIVE, LogisticsStatus.DISPATCHED],
    [UserRole.SUPERADMIN, LogisticsStatus.DISPATCHED],
  ])(
    'lets a %s correct the date of a %s order, recording before, after, actor and reason',
    async (role, status) => {
      const {
        service,
        order,
        orderUpdate,
        orderUpdateMany,
        leadUpdate,
        auditCreateMany,
        queryRaw,
        orderFindFirst,
      } = makeService({ role, status, deliveryDate: day('2026-10-18') });

      const result = await service.correctDeliveryDate(
        ORDER,
        correct('2026-10-22'),
      );

      expect(orderUpdate).toHaveBeenCalledWith({
        where: { id: ORDER },
        data: { deliveryDate: day('2026-10-22') },
      });
      expect(result.deliveryDate).toBe('2026-10-22');
      expect(result.status).toBe(status);
      expect(order.status).toBe(status);
      expect(orderUpdateMany).not.toHaveBeenCalled();
      expect(leadUpdate).not.toHaveBeenCalled();
      // The row is locked before it is read.
      expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        orderFindFirst.mock.invocationCallOrder[0],
      );
      expect(events(auditCreateMany)).toEqual([
        expect.objectContaining({
          entityType: 'LOGISTICS_ORDER',
          entityId: ORDER,
          leadId: LEAD,
          action: 'UPDATED',
          actorType: 'USER',
          actorId: USER,
          source: 'logistics.delivery_date_correction',
          before: { deliveryDate: '2026-10-18' },
          after: { deliveryDate: '2026-10-22' },
          metadata: { reason: 'Customer asked to move it' },
        }),
      ]);
    },
  );

  it('dates an undated QC-verified order, which then may be dispatched', async () => {
    const { service } = makeService({
      role: UserRole.LOGISTICS_EXECUTIVE,
      status: LogisticsStatus.QC_VERIFIED,
    });

    const result = await service.correctDeliveryDate(
      ORDER,
      correct('2026-10-15'),
    );

    expect(result.deliveryDate).toBe('2026-10-15');
    expect(result.allowedActions).toEqual([
      'DISPATCH',
      'CORRECT_DELIVERY_DATE',
    ]);
  });

  it.each([
    LogisticsStatus.INITIAL,
    LogisticsStatus.QC_REJECTED,
    LogisticsStatus.DELIVERED,
    LogisticsStatus.CANCELLED,
    LogisticsStatus.RTO,
  ])(
    'refuses a correction on a %s order with a 409, writing nothing',
    async (status) => {
      const { service, orderUpdate, auditCreateMany } = makeService({
        role: UserRole.LOGISTICS_MANAGER,
        status,
        deliveryDate: day('2026-10-18'),
      });

      const attempt = service.correctDeliveryDate(ORDER, correct('2026-10-22'));

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(
        `This order is ${status}; its delivery date can only be corrected while QC_VERIFIED or DISPATCHED.`,
      );
      expect(orderUpdate).not.toHaveBeenCalled();
      expect(auditCreateMany).not.toHaveBeenCalled();
    },
  );

  it('refuses a day before the business day’s today with a 400, and accepts today', async () => {
    const past = makeService({
      role: UserRole.LOGISTICS_MANAGER,
      status: LogisticsStatus.DISPATCHED,
      deliveryDate: day('2026-10-18'),
    });
    const attempt = past.service.correctDeliveryDate(
      ORDER,
      correct('2026-10-14'),
    );
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(
      'The delivery date can’t be before today, 15-10-2026 (Asia/Dubai).',
    );
    expect(past.orderUpdate).not.toHaveBeenCalled();
    expect(past.auditCreateMany).not.toHaveBeenCalled();

    const today = makeService({
      role: UserRole.LOGISTICS_MANAGER,
      status: LogisticsStatus.DISPATCHED,
      deliveryDate: day('2026-10-18'),
    });
    await expect(
      today.service.correctDeliveryDate(ORDER, correct('2026-10-15')),
    ).resolves.toMatchObject({ deliveryDate: '2026-10-15' });
  });

  it('writes and records nothing when the date is the one the order has', async () => {
    const { service, orderUpdate, auditCreateMany } = makeService({
      role: UserRole.LOGISTICS_MANAGER,
      status: LogisticsStatus.QC_VERIFIED,
      deliveryDate: day('2026-10-18'),
    });

    const result = await service.correctDeliveryDate(
      ORDER,
      correct('2026-10-18'),
    );

    expect(result.deliveryDate).toBe('2026-10-18');
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('404s an order outside the caller’s scope', async () => {
    const { service, orderUpdate } = makeService({
      role: UserRole.LOGISTICS_MANAGER,
      status: LogisticsStatus.QC_VERIFIED,
      inScope: false,
    });

    await expect(
      service.correctDeliveryDate(ORDER, correct('2026-10-20')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(orderUpdate).not.toHaveBeenCalled();
  });
});

describe('CorrectDeliveryDateDto', () => {
  const errorsOf = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(CorrectDeliveryDateDto, body))).map(
      (error) => [error.property, Object.values(error.constraints ?? {})],
    );

  it('takes a day and a reason, trimmed', async () => {
    const dto = plainToInstance(CorrectDeliveryDateDto, {
      deliveryDate: '2026-10-22',
      reason: '  Customer asked to move it  ',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.reason).toBe('Customer asked to move it');
  });

  it.each([
    {},
    { deliveryDate: null },
    { deliveryDate: '' },
    { deliveryDate: '  ' },
  ])('refuses a missing or cleared date %j', async (date) => {
    expect(await errorsOf({ ...date, reason: 'x' })).toEqual([
      [
        'deliveryDate',
        [
          'Delivery Date is required; an order’s delivery date can’t be cleared',
        ],
      ],
    ]);
  });

  it.each(['2026-02-30', '22-10-2026', '2026-10-22T00:00:00.000Z'])(
    'refuses %j, which is not a real YYYY-MM-DD day',
    async (deliveryDate) => {
      expect(await errorsOf({ deliveryDate, reason: 'x' })).toEqual([
        [
          'deliveryDate',
          [
            'Delivery Date must be a real date written YYYY-MM-DD (years 2000-2099)',
          ],
        ],
      ]);
    },
  );

  it.each([{}, { reason: '' }, { reason: '   ' }])(
    'requires a reason: %j is refused',
    async (reason) => {
      expect(
        (await errorsOf({ deliveryDate: '2026-10-22', ...reason })).map(
          ([property]) => property,
        ),
      ).toEqual(['reason']);
    },
  );

  it('caps the reason at 500 characters', async () => {
    expect(
      (
        await errorsOf({ deliveryDate: '2026-10-22', reason: 'x'.repeat(501) })
      ).map(([property]) => property),
    ).toEqual(['reason']);
  });
});
