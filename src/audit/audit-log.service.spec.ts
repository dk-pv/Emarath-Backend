import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../generated/prisma/client';
import { ROLES_KEY } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY_TYPES } from './audit-events';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService, HIDDEN, redactAuditValue } from './audit-log.service';
import { ListAuditLogDto } from './dto/audit-log.dto';

const LEAD = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

const event = (over: Record<string, unknown> = {}) => ({
  id: 'event-1',
  entityType: 'USER',
  entityId: USER,
  leadId: null,
  action: 'UPDATED',
  actorType: 'USER',
  actorId: ADMIN,
  source: 'users.update',
  before: null,
  after: null,
  metadata: null,
  createdAt: new Date('2026-10-20T08:00:00.000Z'),
  actor: { name: 'ZZ Admin' },
  ...over,
});

function makeService(
  rows: ReturnType<typeof event>[] = [event()],
  total = rows.length,
) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(total);
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
  const named = (pairs: [string, string][]) =>
    jest.fn((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        pairs
          .filter(([id]) => args.where.id.in.includes(id))
          .map(([id, name]) => ({ id, name })),
      ),
    );
  const lookups = {
    user: {
      findMany: jest.fn(
        (args: { where?: { id: { in: string[] } }; take?: number }) =>
          Promise.resolve(
            args.where
              ? [{ id: USER, name: 'ZZ Agent' }].filter((u) =>
                  args.where!.id.in.includes(u.id),
                )
              : [
                  { id: ADMIN, name: 'ZZ Admin' },
                  { id: USER, name: 'ZZ Agent' },
                ],
          ),
      ),
    },
    role: { findMany: named([['role-1', 'ZZ Sales']]) },
    pipeline: { findMany: named([]) },
    integration: { findMany: named([]) },
    lead: { findMany: named([[LEAD, 'Acme Villa']]) },
    document: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'doc-1', title: 'Contract' }]),
    },
    logisticsOrder: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'order-1', orderNumber: 1042 }]),
    },
    stage: { findMany: named([['stage-1', 'HOT']]) },
    leadForm: { findMany: named([['form-1', 'CS Complaint']]) },
    leadCustomField: { findMany: named([['field-1', 'National Code']]) },
    leadSource: { findMany: named([['source-1', 'Website']]) },
    assignmentRule: { findMany: named([['rule-1', 'Round robin']]) },
    tag: { findMany: named([['tag-1', 'BDE RISK']]) },
  };
  const prisma = {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    auditEvent: { findMany, count, ...writes },
    ...lookups,
  } as unknown as PrismaService;
  return {
    service: new AuditLogService(prisma),
    findMany,
    count,
    writes,
    lookups,
  };
}

const query = (over: Partial<ListAuditLogDto> = {}) =>
  Object.assign(new ListAuditLogDto(), over);

describe('AuditLogService.list (AUD-02)', () => {
  it('reads newest first with an id tie-break, one bounded page, and counts the whole match', async () => {
    const { service, findMany, count } = makeService([event()], 120);

    const result = await service.list(query({ page: 3, size: 25 }));

    const [args] = findMany.mock.calls[0] as [Record<string, unknown>];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
    expect(args.where).toEqual({ entityType: undefined, actorId: undefined });
    expect(count).toHaveBeenCalledWith({ where: args.where });
    expect(result.total).toBe(120);
  });

  it('narrows by record type, by user and by a [from, to) window', async () => {
    const { service, findMany } = makeService();

    await service.list(
      query({
        entityType: 'ROLE',
        actorId: ADMIN,
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
      }),
    );

    const [{ where }] = findMany.mock.calls[0] as [{ where: unknown }];
    expect(where).toEqual({
      entityType: 'ROLE',
      actorId: ADMIN,
      createdAt: {
        gte: new Date('2026-10-01T00:00:00.000Z'),
        lt: new Date('2026-10-02T00:00:00.000Z'),
      },
    });
  });

  it('takes an open-ended window', async () => {
    const { service, findMany } = makeService();

    await service.list(query({ from: '2026-10-01T00:00:00.000Z' }));

    const [{ where }] = findMany.mock.calls[0] as [
      { where: { createdAt: { gte?: Date; lt?: Date } } },
    ];
    expect(where.createdAt.gte).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(where.createdAt.lt).toBeUndefined();
  });

  it('refuses a window whose end is not after its start, before reading anything', async () => {
    const { service, findMany } = makeService();

    for (const [from, to] of [
      ['2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
      ['2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z'],
    ]) {
      await expect(service.list(query({ from, to }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns an empty page as an empty page, asking no label query', async () => {
    const { service, lookups } = makeService([], 0);

    await expect(service.list(query())).resolves.toEqual({
      rows: [],
      total: 0,
    });
    expect(lookups.lead.findMany).not.toHaveBeenCalled();
    expect(lookups.user.findMany).not.toHaveBeenCalled();
  });

  it('names who acted and what each record is; an activity reads as its lead, a gone record as null', async () => {
    const { service } = makeService([
      event({ id: 'e1', entityType: 'USER', entityId: USER }),
      event({ id: 'e2', entityType: 'ROLE', entityId: 'role-1' }),
      event({ id: 'e3', entityType: 'LEAD', entityId: LEAD, leadId: LEAD }),
      event({
        id: 'e4',
        entityType: 'ACTIVITY',
        entityId: 'act-1',
        leadId: LEAD,
      }),
      event({ id: 'e5', entityType: 'DOCUMENT', entityId: 'doc-1' }),
      event({
        id: 'e6',
        entityType: 'LOGISTICS_ORDER',
        entityId: 'order-1',
        leadId: LEAD,
      }),
      event({ id: 'e7', entityType: 'ROLE', entityId: 'role-gone' }),
      event({
        id: 'e8',
        entityType: 'SETTING',
        entityId: 'setting-1',
        actorType: 'SYSTEM',
        actorId: null,
        actor: null,
      }),
    ]);

    const { rows } = await service.list(query());

    expect(rows.map((row) => row.entityLabel)).toEqual([
      'ZZ Agent',
      'ZZ Sales',
      'Acme Villa',
      'Acme Villa',
      'Contract',
      '#1042',
      null,
      null,
    ]);
    expect(rows[0].actorName).toBe('ZZ Admin');
    expect(rows[7].actorName).toBeNull();
    expect(rows[0].createdAt).toBe('2026-10-20T08:00:00.000Z');
  });

  it('names the configuration records by their own names (AUD-03); a deleted one reads as null', async () => {
    const { service } = makeService([
      event({ id: 'c1', entityType: 'STAGE', entityId: 'stage-1' }),
      event({ id: 'c2', entityType: 'LEAD_FORM', entityId: 'form-1' }),
      event({ id: 'c3', entityType: 'CUSTOM_FIELD', entityId: 'field-1' }),
      event({ id: 'c4', entityType: 'LEAD_SOURCE', entityId: 'source-1' }),
      event({ id: 'c5', entityType: 'ASSIGNMENT_RULE', entityId: 'rule-1' }),
      event({ id: 'c6', entityType: 'TAG', entityId: 'tag-1' }),
      event({ id: 'c7', entityType: 'LEAD_SOURCE', entityId: 'source-gone' }),
    ]);

    const { rows } = await service.list(query());

    expect(rows.map((row) => row.entityLabel)).toEqual([
      'HOT',
      'CS Complaint',
      'National Code',
      'Website',
      'Round robin',
      'BDE RISK',
      null,
    ]);
  });

  it('shows a form whose arrangement lists the email field: a field key is a value, not hidden', async () => {
    const fields = [
      { key: 'name', section: null, visible: true },
      { key: 'email', section: 'Contact', visible: false },
    ];
    const { service } = makeService([
      event({
        entityType: 'LEAD_FORM',
        entityId: 'form-1',
        before: { fields: [] },
        after: { fields },
      }),
    ]);

    const { rows } = await service.list(query());

    expect(rows[0].after).toEqual({ fields });
  });

  it('hides sensitive values at every depth before they leave the API', async () => {
    const { service } = makeService([
      event({
        before: {
          email: 'old@example.com',
          avatarKey: 'avatars/abc/me.png',
          jobTitle: 'BDE',
        },
        after: {
          email: 'new@example.com',
          passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
          nested: [
            {
              storageKey: 'documents/x/y.pdf',
              note: 'mail me at a.b@c.co please',
            },
          ],
          jobTitle: 'Lead',
        },
        metadata: {
          filters: { search: true, conditions: true, status: ['New'] },
          token: 'raw',
          fromEmailAddress: 'noreply@emarath.test',
          subject: 'Hello',
        },
      }),
    ]);

    const [row] = (await service.list(query())).rows;

    expect(row.before).toEqual({
      email: HIDDEN,
      avatarKey: HIDDEN,
      jobTitle: 'BDE',
    });
    expect(row.after).toEqual({
      email: HIDDEN,
      passwordHash: HIDDEN,
      nested: [{ storageKey: HIDDEN, note: `mail me at ${HIDDEN} please` }],
      jobTitle: 'Lead',
    });
    expect(row.metadata).toEqual({
      filters: { search: HIDDEN, conditions: HIDDEN, status: ['New'] },
      token: HIDDEN,
      fromEmailAddress: HIDDEN,
      subject: 'Hello',
    });
    expect(JSON.stringify(row)).not.toMatch(
      /@example\.com|\$2b\$|avatars\/|documents\//,
    );
  });

  it('never writes: reading the log touches no mutator on the table', async () => {
    const { service, writes } = makeService();

    await service.list(query());
    await service.filterOptions();

    for (const write of Object.values(writes))
      expect(write).not.toHaveBeenCalled();
  });
});

describe('redactAuditValue', () => {
  it('hides a bcrypt hash wherever it sits and leaves ordinary values alone', () => {
    expect(redactAuditValue('$2a$10$abcdefghijklmnopqrstuv')).toBe(HIDDEN);
    expect(redactAuditValue(['ok', 3, true, null])).toEqual([
      'ok',
      3,
      true,
      null,
    ]);
    expect(
      redactAuditValue({ secretKey: 'x', tokenHash: 'y', name: 'z' }),
    ).toEqual({
      secretKey: HIDDEN,
      tokenHash: HIDDEN,
      name: 'z',
    });
  });
});

describe('AuditLogService.filterOptions (AUD-02)', () => {
  it('offers every recorded type and the staff directory, name order, bounded', async () => {
    const { service, lookups } = makeService();

    const options = await service.filterOptions();

    expect(options.entityTypes).toEqual(AUDIT_ENTITY_TYPES);
    expect(options.actors).toEqual([
      { id: ADMIN, name: 'ZZ Admin' },
      { id: USER, name: 'ZZ Agent' },
    ]);
    const [args] = lookups.user.findMany.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(args.select).toEqual({ id: true, name: true });
    expect(args.take).toBe(1000);
  });
});

describe('ListAuditLogDto', () => {
  const check = async (raw: Record<string, unknown>) => {
    const dto = plainToInstance(ListAuditLogDto, raw);
    return { dto, errors: await validate(dto) };
  };

  it('defaults to the first page of 25', async () => {
    const { dto, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.size).toBe(25);
  });

  it('accepts every recorded type, a user id and ISO instants', async () => {
    const { errors } = await check({
      entityType: 'EXPORT',
      actorId: USER,
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02',
      page: '2',
      size: '100',
    });
    expect(errors).toHaveLength(0);
  });

  it.each([
    [{ entityType: 'PASSWORD' }, 'entityType'],
    [{ actorId: 'not-a-uuid' }, 'actorId'],
    [{ from: 'yesterday' }, 'from'],
    [{ to: '2026-02-30' }, 'to'],
    [{ page: '0' }, 'page'],
    [{ page: '1001' }, 'page'],
    [{ page: 'abc' }, 'page'],
    [{ size: '0' }, 'size'],
    [{ size: '101' }, 'size'],
  ])('refuses %j', async (raw, field) => {
    const { errors } = await check(raw);
    expect(errors.map((error) => error.property)).toContain(field);
  });
});

describe('AuditLogController (AUD-02)', () => {
  it('is Super Admin only, on the class, so no route can forget it', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AuditLogController)).toEqual([
      UserRole.SUPERADMIN,
    ]);
  });

  it('offers reads only: no route creates, changes or deletes an event', () => {
    const proto = AuditLogController.prototype as unknown as Record<
      string,
      object
    >;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map(
        (name) =>
          Reflect.getMetadata(METHOD_METADATA, proto[name]) as RequestMethod,
      );
    expect(methods).toEqual([RequestMethod.GET, RequestMethod.GET]);
  });
});
