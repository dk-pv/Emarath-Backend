import { NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';
import { ListAuditEventsDto } from './dto/audit-event.dto';

const LEAD = '11111111-1111-4111-8111-111111111111';
const ORDER = '33333333-3333-4333-8333-333333333333';
const USER = '22222222-2222-4222-8222-222222222222';

type Row = {
  id: string;
  entityType: string;
  entityId: string;
  leadId: string | null;
  action: string;
  actorType: string;
  actorId: string | null;
  source: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: Date;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  id: 'event-1',
  entityType: 'LEAD',
  entityId: LEAD,
  leadId: LEAD,
  action: 'CREATED',
  actorType: 'USER',
  actorId: USER,
  source: 'leads.create',
  before: null,
  after: { status: 'New' },
  metadata: null,
  createdAt: new Date('2026-09-23T08:00:00.000Z'),
  ...overrides,
});

interface Options {
  role?: UserRole;
  team?: string | null;
  /** Whether the caller's lead scope matches this lead, and whether its order does. */
  lead?: boolean;
  order?: boolean;
  rows?: Row[];
  total?: number;
}

function makeService(options: Options = {}) {
  const rows = options.rows ?? [row()];
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(options.total ?? rows.length);
  // Every write Prisma offers on the table, so a test can prove none of them is reached.
  const writes = {
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  };
  const leadFindFirst = jest
    .fn()
    .mockResolvedValue(options.lead === false ? null : { id: LEAD });
  const orderFindFirst = jest
    .fn()
    .mockResolvedValue(options.order ? { id: ORDER } : null);

  const prisma = {
    $transaction: jest.fn((arg: Promise<unknown>[]) => Promise.all(arg)),
    auditEvent: { findMany, count, ...writes },
    lead: { findFirst: leadFindFirst },
    logisticsOrder: { findFirst: orderFindFirst },
  } as unknown as PrismaService;

  const user = {
    id: USER,
    role: options.role ?? UserRole.SALES_AGENT,
    team: options.team ?? null,
  };
  const currentUser = {
    resolve: jest.fn().mockResolvedValue(user),
  } as unknown as CurrentUserService;

  return {
    service: new AuditEventsService(prisma, currentUser),
    user,
    findMany,
    count,
    writes,
    leadFindFirst,
    orderFindFirst,
  };
}

const query = (overrides: Partial<ListAuditEventsDto> = {}) =>
  Object.assign(new ListAuditEventsDto(), { leadId: LEAD, ...overrides });

/** The first call's argument, typed — `mock.calls` is `any`, which the lint bans. */
const firstArg = <T>(mock: jest.Mock): T =>
  (mock.mock.calls[0] as unknown as [T])[0];

type QueryArgs = {
  where: unknown;
  orderBy?: unknown;
  select?: unknown;
  skip?: number;
  take?: number;
};

const whereOf = (mock: jest.Mock): unknown => firstArg<QueryArgs>(mock).where;

describe('AuditEventsService.list', () => {
  it('returns the journey of a lead the caller can see', async () => {
    const { service, findMany } = makeService();

    const result = await service.list(query());

    expect(whereOf(findMany)).toEqual({ leadId: LEAD });
    expect(result.total).toBe(1);
    expect(result.rows[0]).toEqual({
      id: 'event-1',
      entityType: 'LEAD',
      entityId: LEAD,
      leadId: LEAD,
      action: 'CREATED',
      actorType: 'USER',
      actorId: USER,
      source: 'leads.create',
      before: null,
      after: { status: 'New' },
      metadata: null,
      createdAt: '2026-09-23T08:00:00.000Z',
    });
  });

  it('reads oldest first, breaking ties on id so a row never repeats across pages', async () => {
    const { service, findMany } = makeService({
      rows: [
        row({ id: 'a', createdAt: new Date('2026-09-23T08:00:00.000Z') }),
        row({ id: 'b', createdAt: new Date('2026-09-23T09:00:00.000Z') }),
      ],
    });

    const result = await service.list(query());

    expect(firstArg<QueryArgs>(findMany).orderBy).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(result.rows.map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('pages, and counts the whole journey rather than the page', async () => {
    const { service, findMany } = makeService({ total: 7 });

    const result = await service.list(query({ page: 3, size: 2 }));

    expect(firstArg<QueryArgs>(findMany)).toMatchObject({ skip: 4, take: 2 });
    expect(result.total).toBe(7);
  });

  it('returns an empty journey as an empty page, not an error', async () => {
    const { service } = makeService({ rows: [], total: 0 });

    await expect(service.list(query())).resolves.toEqual({
      rows: [],
      total: 0,
    });
  });

  /*
    The point of `leadId` as the journey key (ADR-0083): a reader compiled today hands back the
    Logistics, Accounts and payment events of later phases without a contract change.
  */
  it('returns entity types this phase has never written', async () => {
    const { service, findMany } = makeService({
      role: UserRole.SUPERADMIN,
      rows: [
        row({ id: 'a', entityType: 'LEAD', action: 'CONVERTED' }),
        row({
          id: 'b',
          entityType: 'LOGISTICS_ORDER',
          entityId: ORDER,
          action: 'QC_REJECTED',
          metadata: { remarks: 'Wrong address' },
        }),
        row({ id: 'c', entityType: 'ACCOUNTS_ORDER', action: 'CREATED' }),
        row({ id: 'd', entityType: 'PAYMENT', action: 'CREATED' }),
      ],
    });

    const result = await service.list(query());

    // The journey is the lead id and nothing else — no entity type is named, so none is missed.
    expect(whereOf(findMany)).toEqual({ leadId: LEAD });
    expect(result.rows.map((event) => event.entityType)).toEqual([
      'LEAD',
      'LOGISTICS_ORDER',
      'ACCOUNTS_ORDER',
      'PAYMENT',
    ]);
    expect(result.rows[1].metadata).toEqual({ remarks: 'Wrong address' });
  });

  it('never writes: reading a journey touches no mutator on the table', async () => {
    const { service, writes } = makeService();

    await service.list(query());

    for (const write of Object.values(writes)) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});

describe('AuditEventsService authorization', () => {
  const ALL_LEADS = { deletedAt: null };
  const TEAM_LEADS = {
    deletedAt: null,
    assignments: { some: { user: { team: 'Dubai' } } },
  };
  const OWN_LEADS = {
    deletedAt: null,
    assignments: { some: { userId: USER } },
  };
  const NO_LEADS = { deletedAt: null, id: { in: [] } };

  /*
    Every role, its two lookups written out rather than read back from the scope helpers, so a
    change that widened any role's reach fails here instead of quietly reaching this endpoint.
    Neither lookup matches, which is also exactly the path of a sales agent who swaps in another
    agent's leadId: both asks carry their own assignment, and the answer is a 404 — the same
    words the lead reads use, so the endpoint cannot probe for leads. Accounts is refused
    earlier, at the guard; its row is the second wall behind that.
  */
  it.each([
    { role: UserRole.SUPERADMIN, lead: ALL_LEADS, order: {} },
    {
      role: UserRole.SALES_MANAGER,
      lead: TEAM_LEADS,
      order: { lead: TEAM_LEADS },
    },
    { role: UserRole.SALES_AGENT, lead: OWN_LEADS, order: { lead: OWN_LEADS } },
    {
      role: UserRole.CUSTOMER_SERVICE_AGENT,
      lead: ALL_LEADS,
      order: { lead: ALL_LEADS },
    },
    {
      role: UserRole.MARKETING_ANALYST,
      lead: ALL_LEADS,
      order: { lead: ALL_LEADS },
    },
    { role: UserRole.LOGISTICS_MANAGER, lead: NO_LEADS, order: {} },
    { role: UserRole.LOGISTICS_EXECUTIVE, lead: NO_LEADS, order: {} },
    { role: UserRole.QC, lead: NO_LEADS, order: {} },
    {
      role: UserRole.ACCOUNTS_EXECUTIVE,
      lead: NO_LEADS,
      order: { id: { in: [] } },
    },
  ])(
    '$role reaches a journey only through its own scopes',
    async ({ role, lead, order }) => {
      const { service, leadFindFirst, orderFindFirst, findMany } = makeService({
        role,
        team: 'Dubai',
        lead: false,
        order: false,
      });

      await expect(service.list(query())).rejects.toThrow(
        new NotFoundException(
          'That lead does not exist or is not in your scope.',
        ),
      );
      expect(firstArg<QueryArgs>(leadFindFirst)).toEqual({
        where: { AND: [lead, { id: LEAD }] },
        select: { id: true },
      });
      expect(firstArg<QueryArgs>(orderFindFirst)).toEqual({
        where: { AND: [order, { leadId: LEAD }] },
        select: { id: true },
      });
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  /*
    ADR-0084: the operational roles hold no sales access. They reach a journey only through the
    order they work, and then read that order's own events — never the lead's, which carry the
    sales data the guard and the scope helpers keep from them.
  */
  it.each([
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.QC,
  ])('gives %s its order’s events and none of the lead’s', async (role) => {
    const { service, findMany } = makeService({
      role,
      lead: false,
      order: true,
    });

    await service.list(query());

    expect(whereOf(findMany)).toEqual({
      leadId: LEAD,
      entityType: 'LOGISTICS_ORDER',
    });
  });
});

describe('the journey route', () => {
  it('is read-only: one GET and no other verb', () => {
    const proto = AuditEventsController.prototype as unknown as Record<
      string,
      unknown
    >;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) =>
        name !== 'constructor' &&
        Reflect.getMetadata(METHOD_METADATA, proto[name] as object) !==
          undefined,
    );

    expect(handlers).toEqual(['list']);
    expect(Reflect.getMetadata(METHOD_METADATA, proto.list as object)).toBe(
      RequestMethod.GET,
    );
  });
});

describe('ListAuditEventsDto validation', () => {
  const errorsFor = async (raw: unknown): Promise<string[]> => {
    const dto = plainToInstance(ListAuditEventsDto, raw);
    const errors = await validate(dto);
    return errors.map((error) => error.property);
  };

  it('refuses a leadId that is not a uuid, and one that is missing', async () => {
    expect(await errorsFor({ leadId: 'not-a-uuid' })).toEqual(['leadId']);
    expect(await errorsFor({})).toEqual(['leadId']);
  });

  it('accepts a uuid and defaults the page', async () => {
    const dto = plainToInstance(ListAuditEventsDto, { leadId: LEAD });

    expect(await validate(dto)).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.size).toBe(50);
  });

  it('refuses a page size beyond the cap', async () => {
    expect(await errorsFor({ leadId: LEAD, size: '500' })).toEqual(['size']);
  });
});
