import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsRecordsService } from './accounts-records.service';
import { ListAccountsRecordsDto } from './dto/accounts-record.dto';

const RECORD = '44444444-4444-4444-4444-444444444444';
const ORDER = '33333333-3333-3333-3333-333333333333';
const LEAD = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const P = PaymentStatus;
const ALL_STATUSES = Object.values(PaymentStatus);

/** The approved provisional moves (2026-10-17), written out again so the service is tested against it. */
const MOVES: Record<PaymentStatus, PaymentStatus[]> = {
  INITIAL: [
    P.PAYMENT_PENDING,
    P.PAYMENT_RECEIVED,
    P.PAYMENT_FAILED,
    P.PARTIALLY_PAID,
  ],
  PAYMENT_PENDING: [P.PAYMENT_RECEIVED, P.PAYMENT_FAILED, P.PARTIALLY_PAID],
  PARTIALLY_PAID: [P.PAYMENT_RECEIVED, P.PAYMENT_FAILED],
  PAYMENT_FAILED: [P.PAYMENT_PENDING, P.PAYMENT_RECEIVED, P.PARTIALLY_PAID],
  PAYMENT_RECEIVED: [],
};

interface Options {
  status?: PaymentStatus;
  role?: UserRole;
  /** A concurrent change that commits between the service's read and its write. */
  racedTo?: PaymentStatus;
}

/**
 * A stateful double: the record is an object the writes mutate, and the conditional update
 * behaves as the database would — it changes the row only while its status is still the one the
 * update names. A read through a scope that matches nothing (`id: { in: [] }`) finds nothing.
 */
function makeService(options: Options = {}) {
  const record = {
    id: RECORD,
    status: options.status ?? P.INITIAL,
    statusChangedAt: new Date('2026-10-17T08:00:00.000Z'),
    createdAt: new Date('2026-10-17T08:00:00.000Z'),
    order: {
      id: ORDER,
      orderNumber: 1001,
      leadId: LEAD,
      customerName: 'Acme Trading',
      primaryPhone: '971500000000',
      country: 'United Arab Emirates',
      city: 'Dubai',
      product: 'MIRAMAR COMBO',
      orderValue: new Prisma.Decimal('250.50'),
      paymentMethod: 'COD',
      awbNumber: 'AWB-1',
      courier: 'Aramex',
      deliveredAt: new Date('2026-10-17T08:00:00.000Z'),
      deliveryDate: new Date('2026-10-17T00:00:00.000Z'),
    },
  };
  const visible = (where: unknown) => {
    const json = JSON.stringify(where);
    return (
      !json.includes('"id":{"in":[]}') && json.includes(`"id":"${RECORD}"`)
    );
  };
  const findFirst = jest.fn((args: { where: unknown }) =>
    Promise.resolve(
      visible(args.where) ? { ...record, order: { ...record.order } } : null,
    ),
  );
  const updateMany = jest.fn(
    (args: {
      where: { id: string; status: PaymentStatus };
      data: { status: PaymentStatus; statusChangedAt: Date };
    }) => {
      if (options.racedTo) record.status = options.racedTo;
      if (args.where.id !== RECORD || args.where.status !== record.status) {
        return Promise.resolve({ count: 0 });
      }
      Object.assign(record, args.data);
      return Promise.resolve({ count: 1 });
    },
  );
  const findUniqueOrThrow = jest.fn(() =>
    Promise.resolve({ status: record.status }),
  );
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    accountsRecord: { findFirst, updateMany, findUniqueOrThrow },
    auditEvent: { createMany: auditCreateMany },
  };
  const findMany = jest.fn().mockResolvedValue([{ ...record }]);
  const count = jest.fn().mockResolvedValue(1);
  const groupBy = jest.fn().mockResolvedValue([]);
  const orderGroupBy = jest.fn().mockResolvedValue([]);
  const prisma = {
    $transaction: jest.fn(
      (arg: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(tx),
    ),
    accountsRecord: { findMany, count, groupBy, findFirst },
    logisticsOrder: { groupBy: orderGroupBy },
  } as unknown as PrismaService;

  const resolve = jest.fn();
  const as = (role: UserRole) =>
    resolve.mockResolvedValue({ id: USER, role, team: null });
  as(options.role ?? UserRole.ACCOUNTS_EXECUTIVE);
  const currentUser = { resolve } as unknown as CurrentUserService;

  return {
    service: new AccountsRecordsService(prisma, currentUser),
    as,
    record,
    findFirst,
    updateMany,
    auditCreateMany,
    findMany,
    count,
    groupBy,
    orderGroupBy,
  };
}

function events(auditCreateMany: jest.Mock): Record<string, unknown>[] {
  return (
    auditCreateMany.mock.calls as [{ data: Record<string, unknown>[] }][]
  ).flatMap((call) => call[0].data);
}

const firstArg = <T>(mock: jest.Mock): T =>
  (mock.mock.calls[0] as unknown as [T])[0];

const query = (
  over: Partial<ListAccountsRecordsDto> = {},
): ListAccountsRecordsDto => ({
  page: 1,
  size: 50,
  sort: 'deliveredAt',
  direction: 'desc',
  ...over,
});

/*
  Every status × every target through the service, as the Accounts Executive: an allowed move
  lands on its target with one event; every other one is a 409 that leaves the record and the log
  untouched — and never reaches the update.
*/
describe('AccountsRecordsService — the full move matrix (provisional)', () => {
  const CELLS = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.map((to) => [from, to, MOVES[from].includes(to)] as const),
  );

  it.each(CELLS)('%s → %s allowed: %s', async (from, to, allowed) => {
    const { service, record, updateMany, auditCreateMany } = makeService({
      status: from,
    });
    const attempt = service.move(RECORD, { status: to, expectedStatus: from });

    if (allowed) {
      const result = await attempt;
      expect(result.status).toBe(to);
      expect(record.status).toBe(to);
      expect(record.statusChangedAt.getTime()).toBeGreaterThan(
        new Date('2026-10-17T08:00:00.000Z').getTime(),
      );
      expect(events(auditCreateMany)).toEqual([
        {
          entityType: 'ACCOUNTS_RECORD',
          entityId: RECORD,
          leadId: LEAD,
          action: 'PAYMENT_STATUS_CHANGED',
          actorType: 'USER',
          actorId: USER,
          source: 'accounts.status',
          before: { status: from },
          after: { status: to },
          metadata: { orderId: ORDER, remarks: null },
        },
      ]);
    } else {
      await expect(attempt).rejects.toThrow(
        new ConflictException(
          `This record is ${from}; it cannot be moved to ${to}. That change needs a correction.`,
        ),
      );
      expect(record.status).toBe(from);
      expect(updateMany).not.toHaveBeenCalled();
      expect(auditCreateMany).not.toHaveBeenCalled();
    }
  });
});

/*
  Q14: a correction takes a record from any status to any other, backwards included, and keeps
  its reason on the event. Only a correction to the status the record already has is refused.
*/
describe('AccountsRecordsService — the full correction matrix', () => {
  const CELLS = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.map((to) => [from, to] as const),
  );

  it.each(CELLS)('%s → %s', async (from, to) => {
    const { service, record, updateMany, auditCreateMany } = makeService({
      status: from,
      role: UserRole.SUPERADMIN,
    });
    const attempt = service.correct(RECORD, {
      status: to,
      expectedStatus: from,
      reason: 'Bank reversed the transfer',
    });

    if (from === to) {
      await expect(attempt).rejects.toThrow(
        new ConflictException(`This record is already ${to}.`),
      );
      expect(updateMany).not.toHaveBeenCalled();
      expect(auditCreateMany).not.toHaveBeenCalled();
      return;
    }
    const result = await attempt;
    expect(result.status).toBe(to);
    expect(record.status).toBe(to);
    expect(events(auditCreateMany)).toEqual([
      {
        entityType: 'ACCOUNTS_RECORD',
        entityId: RECORD,
        leadId: LEAD,
        action: 'PAYMENT_STATUS_CORRECTED',
        actorType: 'USER',
        actorId: USER,
        source: 'accounts.correction',
        before: { status: from },
        after: { status: to },
        metadata: { orderId: ORDER, reason: 'Bank reversed the transfer' },
      },
    ]);
  });
});

describe('AccountsRecordsService — concurrency (expectedStatus)', () => {
  it('refuses a move made against a status the record no longer has, writing nothing', async () => {
    const { service, record, updateMany, auditCreateMany } = makeService({
      status: P.PAYMENT_PENDING,
    });

    await expect(
      service.move(RECORD, {
        status: P.PAYMENT_FAILED,
        expectedStatus: P.INITIAL,
      }),
    ).rejects.toThrow(
      new ConflictException(
        'This record is now PAYMENT_PENDING; reload it before changing its status.',
      ),
    );
    expect(record.status).toBe(P.PAYMENT_PENDING);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('refuses a stale correction the same way', async () => {
    const { service, updateMany } = makeService({
      status: P.PAYMENT_RECEIVED,
      role: UserRole.SUPERADMIN,
    });

    await expect(
      service.correct(RECORD, {
        status: P.PAYMENT_PENDING,
        expectedStatus: P.PAYMENT_FAILED,
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('turns a change that commits between the read and the write into a 409 naming the new status', async () => {
    const { service, record, auditCreateMany, updateMany } = makeService({
      status: P.INITIAL,
      racedTo: P.PAYMENT_FAILED,
    });

    await expect(
      service.move(RECORD, {
        status: P.PAYMENT_RECEIVED,
        expectedStatus: P.INITIAL,
      }),
    ).rejects.toThrow(
      new ConflictException(
        'This record is now PAYMENT_FAILED; reload it before changing its status.',
      ),
    );
    expect(firstArg<{ where: unknown }>(updateMany).where).toEqual({
      id: RECORD,
      status: P.INITIAL,
    });
    expect(record.status).toBe(P.PAYMENT_FAILED);
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});

describe('AccountsRecordsService — scope and response', () => {
  it.each([
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.QC,
    UserRole.SALES_MANAGER,
    UserRole.SALES_AGENT,
  ])(
    'finds no record for %s, even if a route admitted it — a 404 that writes nothing',
    async (role) => {
      const { service, updateMany, auditCreateMany } = makeService({ role });

      await expect(service.get(RECORD)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.move(RECORD, {
          status: P.PAYMENT_PENDING,
          expectedStatus: P.INITIAL,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(updateMany).not.toHaveBeenCalled();
      expect(auditCreateMany).not.toHaveBeenCalled();
    },
  );

  it('returns the record with its order, money as a string and the caller’s next actions', async () => {
    const { service } = makeService({ status: P.PAYMENT_PENDING });

    await expect(service.get(RECORD)).resolves.toEqual({
      id: RECORD,
      status: P.PAYMENT_PENDING,
      statusChangedAt: '2026-10-17T08:00:00.000Z',
      createdAt: '2026-10-17T08:00:00.000Z',
      order: {
        id: ORDER,
        orderNumber: 1001,
        leadId: LEAD,
        customerName: 'Acme Trading',
        primaryPhone: '971500000000',
        country: 'United Arab Emirates',
        city: 'Dubai',
        product: 'MIRAMAR COMBO',
        orderValue: '250.5',
        paymentMethod: 'COD',
        awbNumber: 'AWB-1',
        courier: 'Aramex',
        deliveredAt: '2026-10-17T08:00:00.000Z',
        deliveryDate: '2026-10-17',
      },
      allowedMoves: MOVES.PAYMENT_PENDING,
      canCorrect: false,
    });
  });

  it('answers a move with the actions of the status it reached', async () => {
    const { service } = makeService({ status: P.INITIAL });

    const result = await service.move(RECORD, {
      status: P.PAYMENT_RECEIVED,
      expectedStatus: P.INITIAL,
    });

    expect(result.allowedMoves).toEqual([]);
    expect(result.canCorrect).toBe(false);
  });

  it('keeps a move’s note on its event, trimmed, and a blank one as none', async () => {
    for (const [remarks, kept] of [
      ['  Paid via Tabby  ', 'Paid via Tabby'],
      ['   ', null],
    ] as const) {
      const { service, auditCreateMany } = makeService();
      await service.move(RECORD, {
        status: P.PAYMENT_PENDING,
        expectedStatus: P.INITIAL,
        remarks,
      });
      expect(events(auditCreateMany)[0].metadata).toEqual({
        orderId: ORDER,
        remarks: kept,
      });
    }
  });
});

describe('AccountsRecordsService — list, counts and filter choices', () => {
  it('reads one page through the scope and the filters, with a total', async () => {
    const { service, findMany, count } = makeService();

    const result = await service.list(
      query({
        page: 2,
        size: 20,
        status: [P.PAYMENT_PENDING],
        paymentMethod: ['COD'],
        courier: ['Aramex'],
        search: 'AWB-1',
      }),
    );

    const args = firstArg<{
      where: unknown;
      skip: number;
      take: number;
      orderBy: unknown;
    }>(findMany);
    expect(args.skip).toBe(20);
    expect(args.take).toBe(20);
    expect(args.where).toEqual(firstArg<{ where: unknown }>(count).where);
    expect(args.where).toEqual({
      AND: [
        {},
        { status: { in: [P.PAYMENT_PENDING] } },
        {
          order: {
            AND: [
              {
                OR: [
                  {
                    customerName: { contains: 'AWB-1', mode: 'insensitive' },
                  },
                  {
                    primaryPhone: { contains: 'AWB-1', mode: 'insensitive' },
                  },
                  { awbNumber: { contains: 'AWB-1', mode: 'insensitive' } },
                ],
              },
              { paymentMethod: { in: ['COD'] } },
              { courier: { in: ['Aramex'] } },
            ],
          },
        },
      ],
    });
    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe(RECORD);
  });

  it('matches nothing for a role outside Accounts, whatever the filters', async () => {
    const { service, findMany } = makeService({ role: UserRole.QC });

    await service.list(query());

    expect(
      firstArg<{ where: { AND: unknown[] } }>(findMany).where.AND[0],
    ).toEqual({ id: { in: [] } });
  });

  it.each([
    ['deliveredAt', { order: { deliveredAt: { sort: 'asc', nulls: 'last' } } }],
    ['orderNumber', { order: { orderNumber: 'asc' } }],
    ['customerName', { order: { customerName: 'asc' } }],
    ['status', { status: 'asc' }],
    ['statusChangedAt', { statusChangedAt: 'asc' }],
  ] as const)('sorts by %s, ties broken by id', async (sort, order) => {
    const { service, findMany } = makeService();

    await service.list(query({ sort, direction: 'asc' }));

    expect(firstArg<{ orderBy: unknown }>(findMany).orderBy).toEqual([
      order,
      { id: 'asc' },
    ]);
  });

  it('counts every status, zeros included, under every filter but the status filter', async () => {
    const { service, groupBy } = makeService();
    groupBy.mockResolvedValue([
      { status: P.INITIAL, _count: { _all: 3 } },
      { status: P.PAYMENT_RECEIVED, _count: { _all: 2 } },
    ]);

    const result = await service.summary({
      status: [P.INITIAL],
      courier: ['Aramex'],
    });

    expect(result).toEqual({
      counts: {
        INITIAL: 3,
        PAYMENT_PENDING: 0,
        PAYMENT_RECEIVED: 2,
        PAYMENT_FAILED: 0,
        PARTIALLY_PAID: 0,
      },
      total: 5,
    });
    const where = firstArg<{ where: { AND: unknown[] } }>(groupBy).where;
    expect(where.AND[1]).toEqual({});
    expect(JSON.stringify(where)).toContain('"courier":{"in":["Aramex"]}');
  });

  it('offers the payment methods and couriers of the records’ orders, blanks left out', async () => {
    const { service, orderGroupBy } = makeService();
    orderGroupBy.mockResolvedValue([
      { paymentMethod: 'Tabby', courier: 'Aramex' },
      { paymentMethod: 'COD', courier: null },
      { paymentMethod: ' ', courier: 'Aramex' },
      { paymentMethod: 'COD', courier: 'Tawaseel' },
    ]);

    await expect(service.filterOptions()).resolves.toEqual({
      paymentMethods: ['COD', 'Tabby'],
      couriers: ['Aramex', 'Tawaseel'],
    });
    expect(firstArg<{ where: unknown }>(orderGroupBy).where).toEqual({
      accountsRecord: { is: {} },
    });
  });
});
