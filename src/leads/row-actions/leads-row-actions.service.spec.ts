import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { MailerService } from '../../auth/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TagAccessService } from '../../tag-access/tag-access.service';
import { LeadsBulkService } from '../bulk/leads-bulk.service';
import { BulkActionResponse } from '../bulk/dto/bulk-actions.dto';
import { CreateLeadNoteDto } from './dto/row-actions.dto';
import { LeadRowActionsService } from './leads-row-actions.service';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';

/** A row shaped like LEAD_LIST_SELECT — enough for toLeadListItem to run. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    name: 'Copy',
    firstName: null,
    primaryPhone: '900',
    secondaryPhone: null,
    email: null,
    language: null,
    country: null,
    source: null,
    status: 'New',
    pipeline: 'Lead Pipeline',
    category: null,
    actualAmount: null,
    forecastedAmount: null,
    bookingDate: null,
    callStatus: null,
    callAttempts: 0,
    whatsappAttempts: 0,
    createdAt: new Date('2026-07-21T00:00:00.000Z'),
    updatedAt: new Date('2026-07-21T00:00:00.000Z'),
    assignments: [],
    tags: [],
    product: null,
    productQty: null,
    product2: null,
    product2Qty: null,
    paymentMethod: null,
    nationalCode: null,
    complaints: [],
    customFieldValues: [],
    _count: { activities: 0, calls: 0 },
    ...overrides,
  };
}

/** A row shaped like the audit select (ADR-0083) — only what the log compares. */
function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    status: 'New',
    lostReason: null,
    pipeline: 'Lead Pipeline',
    deletedAt: null,
    assignments: [],
    tags: [],
    customFieldValues: [],
    complaints: [],
    ...overrides,
  };
}

/** The business timezone the services read (`BUSINESS_TIME_ZONE`). */
const config = {
  getOrThrow: () => ({ businessTimeZone: 'Asia/Dubai' }),
} as unknown as ConfigService;

function makeService(
  role: UserRole = UserRole.SUPERADMIN,
  // The pipelines closed to the caller (ADR-0093); none unless a test says so.
  deniedPipelines?: string[],
) {
  const leadFindFirst = jest.fn();
  const leadFindUnique = jest.fn();
  const leadCreate = jest.fn();
  const leadUpdate = jest.fn();
  const leadNoteCreate = jest.fn();
  const stageFindFirst = jest.fn();
  // The audit reads (before/after each change) and the audit write (ADR-0083).
  const auditFindMany = jest.fn().mockResolvedValue([]);
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 0 });

  /** Which leads already carry an order — what the converted-lead guards read. */
  const orderFindMany = jest.fn().mockResolvedValue([]);
  // A copy created straight into WON is re-read inside its transaction (`withLogisticsOrder`).
  const txLeadFindUnique = jest.fn().mockResolvedValue(null);
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    lead: {
      create: leadCreate,
      update: leadUpdate,
      findMany: auditFindMany,
      findUnique: txLeadFindUnique,
    },
    auditEvent: { createMany: auditCreateMany },
    // The conversion hook (ADR-0085): `createManyAndReturn` echoes what it was asked to
    // insert, so a lead that becomes WON gets an order id on its CONVERTED event.
    logisticsOrder: {
      findMany: orderFindMany,
      createManyAndReturn: jest.fn((args: { data: { leadId: string }[] }) =>
        Promise.resolve(
          args.data.map((row, index) => ({
            id: `order-${index + 1}`,
            leadId: row.leadId,
            orderNumber: 1000 + index,
            status: 'INITIAL',
          })),
        ),
      ),
    },
  };
  // The status check (`stageOfPipeline`): every pipeline and stage exists unless a test says
  // otherwise.
  const pipelineFindUnique = jest.fn().mockResolvedValue({ id: 'pipeline-1' });
  const stageFindUnique = jest.fn().mockResolvedValue({ id: 'stage-1' });
  // The copy's assignees (`ASSIGNABLE_USER_WHERE`): every requested user is assignable unless a
  // test says otherwise.
  const userFindMany = jest.fn((args: { where: { id: { in: string[] } } }) =>
    Promise.resolve(args.where.id.in.map((id) => ({ id }))),
  );
  // Writes exist only on the transaction: one that escaped it would throw.
  const prisma = {
    lead: {
      findFirst: leadFindFirst,
      findUnique: leadFindUnique,
    },
    leadNote: {
      create: leadNoteCreate,
    },
    pipeline: { findUnique: pipelineFindUnique },
    stage: { findFirst: stageFindFirst, findUnique: stageFindUnique },
    user: { findMany: userFindMany },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({
      id: 'u1',
      role,
      ...(deniedPipelines ? { deniedPipelines } : {}),
    }),
  } as unknown as CurrentUserService;

  const bulkReassign = jest.fn();
  const bulkDelete = jest.fn();
  const bulk = {
    reassign: bulkReassign,
    delete: bulkDelete,
  } as unknown as LeadsBulkService;

  const sendMail = jest.fn().mockResolvedValue(undefined);
  const mailer = { sendMail } as unknown as MailerService;

  // Tag Permissions (ADR-0091) have their own suite; by default the caller may use every tag.
  const handleable = jest
    .fn()
    .mockImplementation((_user: unknown, tagIds: string[]) =>
      Promise.resolve(tagIds),
    );
  const tagAccess = { handleable } as unknown as TagAccessService;

  const service = new LeadRowActionsService(
    prisma,
    currentUser,
    bulk,
    mailer,
    tagAccess,
    config,
  );
  return {
    handleable,
    service,
    leadFindFirst,
    leadFindUnique,
    txLeadFindUnique,
    leadCreate,
    leadUpdate,
    leadNoteCreate,
    bulkReassign,
    bulkDelete,
    sendMail,
    stageFindFirst,
    pipelineFindUnique,
    stageFindUnique,
    userFindMany,
    auditFindMany,
    auditCreateMany,
    orderFindMany,
  };
}

/** The audit rows written by the one createMany call a change makes. */
function recorded(auditCreateMany: jest.Mock): Record<string, unknown>[] {
  return (
    auditCreateMany.mock.calls[0] as [{ data: Record<string, unknown>[] }]
  )[0].data;
}

const oneResult = (status: 'success' | 'failed'): BulkActionResponse => ({
  results: [
    status === 'success'
      ? { id: LEAD_ID, status }
      : { id: LEAD_ID, status, reason: 'x' },
  ],
  summary: {
    total: 1,
    success: status === 'success' ? 1 : 0,
    failed: status === 'success' ? 0 : 1,
  },
});

describe('LeadRowActionsService.duplicate', () => {
  it('copies fields, assignments and tags into a new record', async () => {
    const { service, leadFindFirst, leadCreate } = makeService();
    leadFindFirst.mockResolvedValue({
      id: LEAD_ID,
      duplicateOfId: null,
      name: 'Acme',
      firstName: null,
      primaryPhone: '900',
      secondaryPhone: null,
      language: 'English',
      country: 'UAE',
      source: null,
      status: 'HOT',
      pipeline: 'Lead Pipeline',
      product: 'Widget',
      productQty: null,
      product2: null,
      product2Qty: null,
      bookingDate: null,
      category: 'Default',
      actualAmount: null,
      forecastedAmount: null,
      paymentMethod: 'Cash',
      state: null,
      street: null,
      city: null,
      nationalCode: null,
      callStatus: null,
      callAttempts: 0,
      whatsappAttempts: 0,
      assignments: [{ userId: AGENT_ID }],
      tags: [{ tagId: 'tag-1' }],
    });
    leadCreate.mockResolvedValue(listRow({ id: 'new-id', name: 'Acme' }));

    const item = await service.duplicate(LEAD_ID);

    expect(item.id).toBe('new-id');
    const data = (leadCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    // scalars carried over, id/timestamps not
    expect(data.data.name).toBe('Acme');
    // …but the status is the new-lead default, not the source's HOT (ADR-0092).
    expect(data.data.status).toBe('New');
    expect(data.data).not.toHaveProperty('id');
    // The copy shares the source's phone, so it is recorded as a duplicate of it (ADR-0092),
    // and the source's own id and link are not copied onto it as scalars.
    expect(data.data.duplicateOf).toEqual({ connect: { id: LEAD_ID } });
    expect(data.data).not.toHaveProperty('duplicateOfId');
    // assignments + tags cloned as nested creates
    expect(data.data.assignments).toEqual({
      create: [{ user: { connect: { id: AGENT_ID } } }],
    });
    expect(data.data.tags).toEqual({
      create: [{ tag: { connect: { id: 'tag-1' } } }],
    });
  });

  it('records a copy of a duplicate against the source’s original, not the source', async () => {
    const { service, leadFindFirst, leadCreate } = makeService();
    leadFindFirst.mockResolvedValue({
      id: LEAD_ID,
      duplicateOfId: 'the-original',
      assignments: [],
      tags: [],
    });
    leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));

    await service.duplicate(LEAD_ID);

    const created = (
      leadCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0];
    // One star around the original, not a chain through the lead that was copied.
    expect(created.data.duplicateOf).toEqual({
      connect: { id: 'the-original' },
    });
  });

  it('copies only the tags the caller may select (Tag Permissions, ADR-0091)', async () => {
    const { service, leadFindFirst, leadCreate, handleable } = makeService(
      UserRole.SALES_AGENT,
    );
    leadFindFirst.mockResolvedValue({
      id: LEAD_ID,
      duplicateOfId: null,
      assignments: [],
      tags: [{ tagId: 'allowed' }, { tagId: 'forbidden' }],
    });
    handleable.mockResolvedValue(['allowed']);
    leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));

    await service.duplicate(LEAD_ID);

    expect(handleable).toHaveBeenCalledWith(
      { id: 'u1', role: UserRole.SALES_AGENT },
      ['allowed', 'forbidden'],
    );
    const created = (
      leadCreate.mock.calls[0] as [{ data: { tags?: unknown } }]
    )[0];
    // The copy must not hand the caller a tag they could not have added themselves.
    expect(created.data.tags).toEqual({
      create: [{ tag: { connect: { id: 'allowed' } } }],
    });
  });

  it('copies no tags at all when none of them is permitted', async () => {
    const { service, leadFindFirst, leadCreate, handleable } = makeService(
      UserRole.SALES_AGENT,
    );
    leadFindFirst.mockResolvedValue({
      id: LEAD_ID,
      duplicateOfId: null,
      assignments: [],
      tags: [{ tagId: 'forbidden' }],
    });
    handleable.mockResolvedValue([]);
    leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));

    await service.duplicate(LEAD_ID);

    const created = (
      leadCreate.mock.calls[0] as [{ data: { tags?: unknown } }]
    )[0];
    expect(created.data.tags).toBeUndefined();
  });

  it('404s when the source is outside the caller scope', async () => {
    const { service, leadFindFirst, leadCreate } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(service.duplicate(LEAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('records the copy as created from its source, with its assignees (ADR-0083)', async () => {
    const {
      service,
      leadFindFirst,
      leadCreate,
      auditFindMany,
      auditCreateMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ assignments: [], tags: [] });
    leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));
    auditFindMany.mockResolvedValue([
      auditRow({ id: 'new-id', assignments: [{ userId: AGENT_ID }] }),
    ]);

    await service.duplicate(LEAD_ID);

    expect(recorded(auditCreateMany)).toMatchObject([
      {
        action: 'CREATED',
        entityId: 'new-id',
        actorId: 'u1',
        source: 'leads.duplicate',
        metadata: { duplicatedFrom: LEAD_ID },
      },
      { action: 'ASSIGNED', after: { assigneeIds: [AGENT_ID] } },
    ]);
  });

  /*
    A copy is a new lead, so it starts where every new lead starts (ADR-0092): the first stage of
    its pipeline, else 'New'. It never inherits the stage the source reached.
  */
  describe('the copy’s status', () => {
    const copyOf = async (
      status: string,
      stage: { name: string } | null = { name: 'New' },
      pipeline = 'Lead Pipeline',
    ) => {
      const kit = makeService();
      kit.leadFindFirst.mockResolvedValue({
        id: LEAD_ID,
        duplicateOfId: null,
        status,
        pipeline,
        lostReason: 'Too expensive',
        assignments: [],
        tags: [],
      });
      kit.stageFindFirst.mockResolvedValue(stage);
      kit.leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));
      kit.auditFindMany.mockResolvedValue([auditRow({ id: 'new-id' })]);
      await kit.service.duplicate(LEAD_ID);
      const created = (
        kit.leadCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      return { kit, created };
    };

    it.each(['LOST', 'WON', 'HOT', 'Cold', 'SUPER HOT'])(
      'starts as New when the source is %s',
      async (status) => {
        const { created } = await copyOf(status);
        expect(created.status).toBe('New');
      },
    );

    it('uses the first stage of the SOURCE’s pipeline, which is not always New', async () => {
      const { kit, created } = await copyOf(
        'LOST',
        { name: 'Intake' },
        'Complaints',
      );

      expect(created.status).toBe('Intake');
      expect(created.pipeline).toBe('Complaints');
      const [query] = kit.stageFindFirst.mock.calls[0] as [
        { where: { pipeline: string } },
      ];
      expect(query.where.pipeline).toBe('Complaints');
    });

    it('falls back to New for a pipeline with no stages', async () => {
      const { created } = await copyOf('WON', null);
      expect(created.status).toBe('New');
    });

    it('never reads the source’s status, lost reason or status timestamp, so none can be copied', async () => {
      const { kit } = await copyOf('LOST');

      const [query] = kit.leadFindFirst.mock.calls[0] as [
        { select: Record<string, unknown> },
      ];
      // The copy's field list is the whole of what crosses over; progress is not on it.
      for (const progress of [
        'status',
        'lostReason',
        'statusChangedAt',
        'deletedAt',
      ]) {
        expect(query.select).not.toHaveProperty(progress);
      }
      expect(query.select).toHaveProperty('pipeline');
    });

    it('leaves the original untouched: it is only read, never updated', async () => {
      const { kit } = await copyOf('LOST');

      expect(kit.leadUpdate).not.toHaveBeenCalled();
      expect(kit.leadFindFirst).toHaveBeenCalledTimes(1);
      // The one lead write is the create of the copy.
      expect(kit.leadCreate).toHaveBeenCalledTimes(1);
    });

    it('does not make a second converted lead from a WON source: no CONVERTED event, no order', async () => {
      const { kit } = await copyOf('WON');

      const events = recorded(kit.auditCreateMany);
      expect(events.map((event) => event.action)).toEqual(['CREATED']);
      expect(
        events.some((event) => event.entityType === 'LOGISTICS_ORDER'),
      ).toBe(false);
    });

    // A reordered board can put WON first, so the copy itself would convert (ADR-0085 B8) — and a
    // converted lead's order needs a delivery date this request cannot carry (client, 2026-10-17).
    it('refuses a copy into a pipeline whose first stage is WON with a 409, creating nothing', async () => {
      const kit = makeService();
      kit.leadFindFirst.mockResolvedValue({
        id: LEAD_ID,
        duplicateOfId: null,
        pipeline: 'Lead Pipeline',
        assignments: [],
        tags: [],
      });
      kit.stageFindFirst.mockResolvedValue({ name: 'WON' });

      const attempt = kit.service.duplicate(LEAD_ID);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(
        'The “Lead Pipeline” pipeline’s first stage is WON, so a copy would be a converted lead without a Delivery Date.',
      );
      expect(kit.leadCreate).not.toHaveBeenCalled();
      expect(kit.auditCreateMany).not.toHaveBeenCalled();
    });

    it('is recorded as created from its source, as a duplicate of it, in its own status', async () => {
      const { kit } = await copyOf('LOST');

      expect(recorded(kit.auditCreateMany)).toMatchObject([
        {
          action: 'CREATED',
          entityId: 'new-id',
          source: 'leads.duplicate',
          metadata: { duplicatedFrom: LEAD_ID },
          after: { status: 'New' },
        },
      ]);
    });
  });
});

/*
  Phase 2A: a copy is a new lead, so its assignees are new assignments — the create rule
  (only a manager or an administrator chooses them) and the active-user rule both apply.
  Regression: the copy cloned every assignee of the source, whoever asked and whatever their state.
*/
describe('LeadRowActionsService.duplicate — assignees', () => {
  const source = (userIds: string[]) => ({
    id: LEAD_ID,
    duplicateOfId: null,
    pipeline: 'Lead Pipeline',
    assignments: userIds.map((userId) => ({ userId })),
    tags: [],
  });
  const copiedIds = (kit: ReturnType<typeof makeService>) => {
    const [args] = kit.leadCreate.mock.calls[0] as [
      {
        data: {
          assignments?: { create: { user: { connect: { id: string } } }[] };
        };
      },
    ];
    return args.data.assignments?.create.map((c) => c.user.connect.id) ?? [];
  };

  it('a manager or administrator copies only live, active, assignable assignees', async () => {
    const kit = makeService(UserRole.SALES_MANAGER);
    kit.leadFindFirst.mockResolvedValue(source([AGENT_ID, 'inactive-1']));
    kit.userFindMany.mockResolvedValue([{ id: AGENT_ID }]);
    kit.leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));

    await kit.service.duplicate(LEAD_ID);

    expect(kit.userFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [AGENT_ID, 'inactive-1'] },
        deletedAt: null,
        isActive: true,
        role: {
          in: [
            UserRole.SALES_AGENT,
            UserRole.SALES_MANAGER,
            UserRole.CUSTOMER_SERVICE_AGENT,
          ],
        },
      },
      select: { id: true },
    });
    expect(copiedIds(kit)).toEqual([AGENT_ID]);
    // The source keeps every assignee it had: it is only read.
    expect(kit.leadUpdate).not.toHaveBeenCalled();
  });

  it('a sales agent’s copy is assigned to the agent alone', async () => {
    const kit = makeService(UserRole.SALES_AGENT);
    kit.leadFindFirst.mockResolvedValue(source(['u1', AGENT_ID]));
    kit.leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));

    await kit.service.duplicate(LEAD_ID);

    expect(copiedIds(kit)).toEqual(['u1']);
  });

  it('a customer service agent who is not on the source makes an unassigned copy', async () => {
    const kit = makeService(UserRole.CUSTOMER_SERVICE_AGENT);
    kit.leadFindFirst.mockResolvedValue(source([AGENT_ID]));
    kit.leadCreate.mockResolvedValue(listRow({ id: 'new-id' }));

    await kit.service.duplicate(LEAD_ID);

    expect(copiedIds(kit)).toEqual([]);
    expect(kit.userFindMany).not.toHaveBeenCalled();
  });
});

describe('LeadRowActionsService.setStatus', () => {
  it('updates the status of an in-scope lead', async () => {
    const { service, leadFindFirst, leadUpdate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadUpdate.mockResolvedValue(listRow({ status: 'WON' }));

    const item = await service.setStatus(LEAD_ID, { status: 'WON' });

    expect(item.status).toBe('WON');
    const args = (leadUpdate.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(args.where.id).toBe(LEAD_ID);
    expect(args.data.status).toBe('WON');
  });

  /*
    Client clarification of 2026-09-23: once an order exists the lead's status belongs to the
    Logistics workflow. The guard lives in the shared change core, so this endpoint — and the
    edit form, the board and bulk with it — is refused without each having to remember.
  */
  it('refuses a status change on a lead that already has a Logistics order', async () => {
    const {
      service,
      leadFindFirst,
      leadUpdate,
      auditFindMany,
      auditCreateMany,
      orderFindMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadUpdate.mockResolvedValue(listRow({ status: 'HOT' }));
    auditFindMany
      .mockResolvedValueOnce([auditRow({ status: 'WON' })])
      .mockResolvedValueOnce([auditRow({ status: 'HOT' })]);
    orderFindMany.mockResolvedValue([{ leadId: LEAD_ID }]);

    await expect(
      service.setStatus(LEAD_ID, { status: 'HOT' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('404s (and never updates) an out-of-scope lead', async () => {
    const { service, leadFindFirst, leadUpdate, auditCreateMany } =
      makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(
      service.setStatus(LEAD_ID, { status: 'WON' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('records Convert as CONVERTED with the status it left, by the caller (ADR-0083)', async () => {
    const {
      service,
      leadFindFirst,
      leadUpdate,
      auditFindMany,
      auditCreateMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadUpdate.mockResolvedValue(listRow({ status: 'WON' }));
    auditFindMany
      .mockResolvedValueOnce([auditRow({ status: 'HOT' })])
      .mockResolvedValueOnce([auditRow({ status: 'WON' })]);

    await service.setStatus(LEAD_ID, {
      status: 'WON',
      deliveryDate: '2099-01-15',
    });

    expect(recorded(auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'LEAD',
        entityId: LEAD_ID,
        leadId: LEAD_ID,
        action: 'CONVERTED',
        actorType: 'USER',
        actorId: 'u1',
        source: 'leads.status',
        before: { status: 'HOT' },
        after: { status: 'WON' },
        metadata: { orderId: 'order-1' },
      }),
      expect.objectContaining({
        entityType: 'LOGISTICS_ORDER',
        action: 'CREATED',
        leadId: LEAD_ID,
      }),
      expect.objectContaining({
        entityType: 'LOGISTICS_ORDER',
        action: 'UPDATED',
        actorId: 'u1',
        source: 'logistics.delivery_date',
        before: { deliveryDate: null },
        after: { deliveryDate: '2099-01-15' },
      }),
    ]);
  });

  it('refuses Convert without a delivery date, recording nothing', async () => {
    const { service, leadFindFirst, auditFindMany, auditCreateMany } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    auditFindMany
      .mockResolvedValueOnce([auditRow({ status: 'HOT' })])
      .mockResolvedValueOnce([auditRow({ status: 'WON' })]);

    await expect(service.setStatus(LEAD_ID, { status: 'WON' })).rejects.toThrow(
      'A Delivery Date is required to convert a lead to WON.',
    );
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('refuses a delivery date on a status change that converts nothing', async () => {
    const { service, leadFindFirst, auditFindMany, auditCreateMany } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    auditFindMany
      .mockResolvedValueOnce([auditRow({ status: 'HOT' })])
      .mockResolvedValueOnce([auditRow({ status: 'LOST' })]);

    await expect(
      service.setStatus(LEAD_ID, {
        status: 'LOST',
        deliveryDate: '2099-01-15',
      }),
    ).rejects.toThrow(
      'A Delivery Date is only accepted when the request converts a lead to WON.',
    );
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  // Regression: Convert answered with `logisticsOrder: null` — the row was read before the
  // order existed — so the list kept offering Delete and the status menu until a reload.
  it('returns a converted lead with the order the conversion created', async () => {
    const { service, leadFindFirst, leadUpdate, leadFindUnique } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadUpdate.mockResolvedValue(
      listRow({ status: 'WON', logisticsOrder: null }),
    );
    leadFindUnique.mockResolvedValue(
      listRow({
        status: 'WON',
        logisticsOrder: { orderNumber: 1000, status: 'INITIAL' },
      }),
    );

    const item = await service.setStatus(LEAD_ID, { status: 'WON' });

    expect(leadFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LEAD_ID } }),
    );
    expect(item.logisticsOrder).toEqual({
      orderNumber: 1000,
      status: 'INITIAL',
    });
  });

  it('does not re-read a lead set to an ordinary status', async () => {
    const { service, leadFindFirst, leadUpdate, leadFindUnique } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadUpdate.mockResolvedValue(
      listRow({ status: 'HOT', logisticsOrder: null }),
    );

    const item = await service.setStatus(LEAD_ID, { status: 'HOT' });

    expect(leadFindUnique).not.toHaveBeenCalled();
    expect(item.logisticsOrder).toBeNull();
  });

  it('writes no event when the status update fails', async () => {
    const {
      service,
      leadFindFirst,
      leadUpdate,
      auditFindMany,
      auditCreateMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    auditFindMany.mockResolvedValue([auditRow()]);
    leadUpdate.mockRejectedValue(new Error('connection lost'));

    await expect(service.setStatus(LEAD_ID, { status: 'WON' })).rejects.toThrow(
      'connection lost',
    );
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});

/*
  Phase 2A: POST /leads/:id/status took any string. A changed status must now be a stage of the
  lead's own pipeline — the rule create, edit and the Kanban move already applied.
*/
describe('LeadRowActionsService.setStatus — stage validation', () => {
  const lead = (status: string, pipeline = 'Lead Pipeline') => ({
    id: LEAD_ID,
    status,
    pipeline,
  });

  it('refuses a status that is no stage (400) and writes nothing', async () => {
    const kit = makeService();
    kit.leadFindFirst.mockResolvedValue(lead('New'));
    kit.stageFindUnique.mockResolvedValue(null);

    await expect(
      kit.service.setStatus(LEAD_ID, { status: 'Bogus' }),
    ).rejects.toThrow(
      '"Bogus" is not a stage of the "Lead Pipeline" pipeline.',
    );
    expect(kit.leadUpdate).not.toHaveBeenCalled();
    expect(kit.auditCreateMany).not.toHaveBeenCalled();
  });

  it('checks the status against the lead’s OWN pipeline, not the default one', async () => {
    const kit = makeService();
    kit.leadFindFirst.mockResolvedValue(lead('Intake', 'Complaints'));
    kit.stageFindUnique.mockResolvedValue(null);

    await expect(
      kit.service.setStatus(LEAD_ID, { status: 'HOT' }),
    ).rejects.toThrow('"HOT" is not a stage of the "Complaints" pipeline.');
    expect(kit.stageFindUnique).toHaveBeenCalledWith({
      where: { pipeline_name: { pipeline: 'Complaints', name: 'HOT' } },
      select: { id: true },
    });
    expect(kit.leadUpdate).not.toHaveBeenCalled();
  });

  it('does not query stages for an unchanged status (a new LOST reason)', async () => {
    const kit = makeService();
    kit.leadFindFirst.mockResolvedValue(lead('LOST'));
    kit.leadUpdate.mockResolvedValue(listRow({ status: 'LOST' }));

    await kit.service.setStatus(LEAD_ID, {
      status: 'LOST',
      lostReason: 'Price',
    });

    expect(kit.pipelineFindUnique).not.toHaveBeenCalled();
    expect(kit.stageFindUnique).not.toHaveBeenCalled();
    expect(kit.leadUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses Convert on a pipeline that has no WON stage, creating no order', async () => {
    const kit = makeService();
    kit.leadFindFirst.mockResolvedValue(lead('Intake', 'Complaints'));
    kit.stageFindUnique.mockResolvedValue(null);

    await expect(
      kit.service.setStatus(LEAD_ID, { status: 'WON' }),
    ).rejects.toThrow('"WON" is not a stage of the "Complaints" pipeline.');
    expect(kit.leadUpdate).not.toHaveBeenCalled();
    expect(kit.auditCreateMany).not.toHaveBeenCalled();
  });

  it('accepts a stage of the lead’s pipeline', async () => {
    const kit = makeService();
    kit.leadFindFirst.mockResolvedValue(lead('Intake', 'Complaints'));
    kit.leadUpdate.mockResolvedValue(
      listRow({ status: 'Resolved', pipeline: 'Complaints' }),
    );

    const item = await kit.service.setStatus(LEAD_ID, { status: 'Resolved' });

    expect(item.status).toBe('Resolved');
    expect(kit.stageFindUnique).toHaveBeenCalledWith({
      where: { pipeline_name: { pipeline: 'Complaints', name: 'Resolved' } },
      select: { id: true },
    });
  });
});

describe('LeadRowActionsService.changePipeline', () => {
  it('records the pipeline move and the first-stage reset it forces (ADR-0083)', async () => {
    const {
      service,
      leadFindFirst,
      leadUpdate,
      stageFindFirst,
      auditFindMany,
      auditCreateMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    stageFindFirst.mockResolvedValue({ name: 'Complaint' });
    leadUpdate.mockResolvedValue(listRow());
    auditFindMany
      .mockResolvedValueOnce([auditRow({ status: 'HOT' })])
      .mockResolvedValueOnce([
        auditRow({ status: 'Complaint', pipeline: 'Complaints' }),
      ]);

    await service.changePipeline(LEAD_ID, { pipeline: 'Complaints' });

    expect(recorded(auditCreateMany)).toMatchObject([
      {
        action: 'STATUS_CHANGED',
        source: 'leads.pipeline',
        before: { status: 'HOT' },
        after: { status: 'Complaint' },
      },
      {
        action: 'PIPELINE_CHANGED',
        source: 'leads.pipeline',
        before: { pipeline: 'Lead Pipeline' },
        after: { pipeline: 'Complaints' },
      },
    ]);
  });

  /*
    The move writes the target pipeline's first stage as the lead's status, so a pipeline whose
    first stage is named WON would convert the lead through this route (ADR-0085 A2 path 5). A
    converted lead's order needs a delivery date (client, 2026-10-17) this request cannot carry,
    so such a move is refused — unless the lead is WON already and so does not convert again.
  */
  it('refuses a move onto a WON first stage with a 409, before anything is written', async () => {
    const {
      service,
      leadFindFirst,
      leadUpdate,
      stageFindFirst,
      auditCreateMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, status: 'HOT' });
    stageFindFirst.mockResolvedValue({ name: 'WON' });

    const attempt = service.changePipeline(LEAD_ID, { pipeline: 'Fulfilment' });

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      'The “Fulfilment” pipeline’s first stage is WON, so moving the lead there would convert it without a Delivery Date.',
    );
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('still moves a lead that is already WON onto a WON first stage — it does not convert again', async () => {
    const {
      service,
      leadFindFirst,
      leadUpdate,
      stageFindFirst,
      auditFindMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, status: 'WON' });
    stageFindFirst.mockResolvedValue({ name: 'WON' });
    leadUpdate.mockResolvedValue(
      listRow({ status: 'WON', pipeline: 'Fulfilment' }),
    );
    auditFindMany
      .mockResolvedValueOnce([auditRow({ status: 'WON' })])
      .mockResolvedValueOnce([
        auditRow({ status: 'WON', pipeline: 'Fulfilment' }),
      ]);

    await service.changePipeline(LEAD_ID, { pipeline: 'Fulfilment' });

    expect(leadUpdate).toHaveBeenCalled();
  });
});

describe('LeadRowActionsService.archive', () => {
  it('records the archive and the restore (ADR-0083)', async () => {
    const {
      service,
      leadFindFirst,
      leadUpdate,
      auditFindMany,
      auditCreateMany,
    } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadUpdate.mockResolvedValue(listRow());
    auditFindMany
      .mockResolvedValueOnce([auditRow()])
      .mockResolvedValueOnce([auditRow({ deletedAt: new Date() })])
      .mockResolvedValueOnce([auditRow({ deletedAt: new Date() })])
      .mockResolvedValueOnce([auditRow()]);

    await service.archive(LEAD_ID);
    await service.unarchive(LEAD_ID);

    const actions = (
      auditCreateMany.mock.calls as [
        { data: { action: string; source: string }[] },
      ][]
    ).map(([args]) => [args.data[0].action, args.data[0].source]);
    expect(actions).toEqual([
      ['ARCHIVED', 'leads.archive'],
      ['UNARCHIVED', 'leads.unarchive'],
    ]);
  });
});

describe('LeadRowActionsService.reassign', () => {
  it('delegates to the bulk reassign and returns the updated lead', async () => {
    const { service, bulkReassign, leadFindUnique } = makeService();
    bulkReassign.mockResolvedValue(oneResult('success'));
    leadFindUnique.mockResolvedValue(listRow());

    const item = await service.reassign(LEAD_ID, { agentId: AGENT_ID });

    expect(item.id).toBe(LEAD_ID);
    expect(bulkReassign).toHaveBeenCalledWith(
      { ids: [LEAD_ID], agentId: AGENT_ID },
      'leads.reassign',
    );
  });

  it('404s when the lead is not actionable', async () => {
    const { service, bulkReassign, leadFindUnique } = makeService();
    bulkReassign.mockResolvedValue(oneResult('failed'));

    await expect(
      service.reassign(LEAD_ID, { agentId: AGENT_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leadFindUnique).not.toHaveBeenCalled();
  });
});

describe('LeadRowActionsService.sendEmail', () => {
  const payload = {
    to: ['someone@example.com'],
    cc: ['cc@example.com'],
    subject: 'Hi',
    message: 'Body',
  };

  it('sends via the mailer for an in-scope lead and reports sent', async () => {
    const { service, leadFindFirst, sendMail } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });

    const res = await service.sendEmail(LEAD_ID, payload);

    expect(res).toEqual({ sent: true });
    expect(sendMail).toHaveBeenCalledWith({
      to: payload.to,
      cc: payload.cc,
      bcc: undefined,
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('404s (and never sends) for an out-of-scope lead', async () => {
    const { service, leadFindFirst, sendMail } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(service.sendEmail(LEAD_ID, payload)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('surfaces a provider failure as a 500 so the composer can retry', async () => {
    const { service, leadFindFirst, sendMail } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    sendMail.mockRejectedValue(new Error('provider down'));

    await expect(service.sendEmail(LEAD_ID, payload)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe('LeadRowActionsService.addNote', () => {
  const NOTE_ID = '33333333-3333-3333-3333-333333333333';

  it('persists a note authored by the current user for an in-scope lead', async () => {
    const { service, leadFindFirst, leadNoteCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadNoteCreate.mockResolvedValue({ id: NOTE_ID });

    const res = await service.addNote(LEAD_ID, {
      body: 'Called, will follow up',
    });

    expect(res).toEqual({ id: NOTE_ID });
    const args = (leadNoteCreate.mock.calls as unknown[][])[0][0] as {
      data: { leadId: string; authorId: string; body: string };
    };
    // Scoped to the lead, authored by the resolved caller (never client-supplied).
    expect(args.data.leadId).toBe(LEAD_ID);
    expect(args.data.authorId).toBe('u1');
    expect(args.data.body).toBe('Called, will follow up');
  });

  it('404s (and never writes) for an out-of-scope lead', async () => {
    const { service, leadFindFirst, leadNoteCreate } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(
      service.addNote(LEAD_ID, { body: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leadNoteCreate).not.toHaveBeenCalled();
  });
});

describe('CreateLeadNoteDto validation', () => {
  const bodyErrors = async (raw: unknown): Promise<string[]> => {
    const dto = plainToInstance(CreateLeadNoteDto, { body: raw });
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  };

  it('accepts a non-empty body', async () => {
    expect(await bodyErrors('Follow up next week')).toEqual([]);
  });

  it('rejects an empty or whitespace-only body (trimmed first)', async () => {
    expect((await bodyErrors('')).length).toBeGreaterThan(0);
    expect((await bodyErrors('   ')).length).toBeGreaterThan(0);
  });

  it('rejects a body over the length cap', async () => {
    expect((await bodyErrors('a'.repeat(20001))).length).toBeGreaterThan(0);
  });
});

describe('LeadRowActionsService.delete', () => {
  it('delegates to the bulk hard-delete and confirms the id', async () => {
    const { service, bulkDelete } = makeService();
    bulkDelete.mockResolvedValue(oneResult('success'));

    const res = await service.delete(LEAD_ID);

    expect(res).toEqual({ id: LEAD_ID });
    expect(bulkDelete).toHaveBeenCalledWith({ ids: [LEAD_ID] }, 'leads.delete');
  });

  it('404s when the lead is not actionable', async () => {
    const { service, bulkDelete } = makeService();
    bulkDelete.mockResolvedValue(oneResult('failed'));

    await expect(service.delete(LEAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('surfaces a retained lead as a 409, not a 404 (ADR-0083)', async () => {
    const { service, bulkDelete } = makeService();
    bulkDelete.mockRejectedValue(new ConflictException('linked records'));

    await expect(service.delete(LEAD_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

// ADR-0093: a lead a sales agent sees only because it is assigned to them, in a pipeline
// closed to them, is theirs to view — every row action that changes it is refused.
describe('LeadRowActionsService — pipeline access (ADR-0093)', () => {
  const VIEW_ONLY =
    'This lead is in the "VIP" pipeline, which you don\'t have access to. You can view it, but not change it.';
  const agentKit = () => {
    const kit = makeService(UserRole.SALES_AGENT, ['VIP']);
    kit.leadFindFirst.mockResolvedValue({
      id: LEAD_ID,
      status: 'New',
      pipeline: 'VIP',
      assignments: [{ userId: 'u1' }],
      tags: [],
      duplicateOfId: null,
    });
    return kit;
  };

  it('Duplicate: refuses a copy into the closed pipeline (B9)', async () => {
    const kit = agentKit();
    await expect(kit.service.duplicate(LEAD_ID)).rejects.toThrow(
      `You don't have access to the "VIP" pipeline.`,
    );
    expect(kit.leadCreate).not.toHaveBeenCalled();
  });

  it('status: refused, nothing written', async () => {
    const kit = agentKit();
    await expect(
      kit.service.setStatus(LEAD_ID, { status: 'HOT' }),
    ).rejects.toThrow(VIEW_ONLY);
    expect(kit.leadUpdate).not.toHaveBeenCalled();
  });

  it('archive and unarchive: refused, nothing written', async () => {
    const kit = agentKit();
    await expect(kit.service.archive(LEAD_ID)).rejects.toThrow(VIEW_ONLY);
    await expect(kit.service.unarchive(LEAD_ID)).rejects.toThrow(VIEW_ONLY);
    expect(kit.leadUpdate).not.toHaveBeenCalled();
  });

  it('note and email: refused, nothing written or sent', async () => {
    const kit = agentKit();
    await expect(kit.service.addNote(LEAD_ID, { body: 'x' })).rejects.toThrow(
      VIEW_ONLY,
    );
    await expect(
      kit.service.sendEmail(LEAD_ID, { to: ['a@b.co'] }),
    ).rejects.toThrow(VIEW_ONLY);
    expect(kit.leadNoteCreate).not.toHaveBeenCalled();
    expect(kit.sendMail).not.toHaveBeenCalled();
  });

  it('delete: refused with the reason, before the bulk path runs', async () => {
    const kit = agentKit();
    await expect(kit.service.delete(LEAD_ID)).rejects.toThrow(VIEW_ONLY);
    expect(kit.bulkDelete).not.toHaveBeenCalled();
  });

  it('delete: a lead outside the caller’s scope still goes to the bulk path (its 404)', async () => {
    const kit = makeService(UserRole.SALES_AGENT, ['VIP']);
    kit.leadFindFirst.mockResolvedValue(null);
    kit.bulkDelete.mockResolvedValue(oneResult('failed'));
    await expect(kit.service.delete(LEAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(kit.bulkDelete).toHaveBeenCalledTimes(1);
  });

  describe('Change Pipeline (B5)', () => {
    it('refuses a manager’s move into a pipeline closed to them, before reading its stages', async () => {
      const kit = makeService(UserRole.SALES_MANAGER, ['VIP']);
      kit.leadFindFirst.mockResolvedValue({
        id: LEAD_ID,
        pipeline: 'Lead Pipeline',
      });
      await expect(
        kit.service.changePipeline(LEAD_ID, { pipeline: 'VIP' }),
      ).rejects.toThrow(`You don't have access to the "VIP" pipeline.`);
      expect(kit.stageFindFirst).not.toHaveBeenCalled();
      expect(kit.leadUpdate).not.toHaveBeenCalled();
    });

    it.each([
      UserRole.SALES_AGENT,
      UserRole.CUSTOMER_SERVICE_AGENT,
      UserRole.MARKETING_ANALYST,
    ])('refuses %s in the service too, not only at the route', async (role) => {
      const kit = makeService(role);
      kit.leadFindFirst.mockResolvedValue({
        id: LEAD_ID,
        pipeline: 'Lead Pipeline',
      });
      await expect(
        kit.service.changePipeline(LEAD_ID, { pipeline: 'Complaints' }),
      ).rejects.toThrow(
        'Only a manager or an administrator can move a lead to another pipeline.',
      );
      expect(kit.leadUpdate).not.toHaveBeenCalled();
    });
  });
});
