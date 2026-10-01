import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { userActor } from '../audit/audit-events';
import {
  LeadAuditContext,
  LeadAuditRow,
  LeadAuditState,
  applyLeadChanges,
  auditLeadChanges,
  leadChangeEvents,
  leadCreatedEvents,
  leadDeleteBlockedEvent,
  leadDeletedEvent,
  recordLeadsCreated,
  toLeadAuditState,
} from './lead-audit';

const LEAD = '11111111-1111-1111-1111-111111111111';
const context: LeadAuditContext = {
  actor: userActor({ id: 'user-1' }),
  source: 'leads.status',
};

/** A row shaped like the audit select. */
function auditRow(overrides: Partial<LeadAuditRow> = {}): LeadAuditRow {
  return {
    id: LEAD,
    name: 'Acme',
    firstName: null,
    primaryPhone: '971500000000',
    secondaryPhone: null,
    email: null,
    language: null,
    country: null,
    source: 'DoubleTick',
    status: 'New',
    lostReason: null,
    pipeline: 'Lead Pipeline',
    product: null,
    productQty: null,
    product2: null,
    product2Qty: null,
    bookingDate: null,
    category: 'Default',
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
    ...overrides,
  };
}

const state = (overrides: Partial<LeadAuditRow> = {}): LeadAuditState =>
  toLeadAuditState(auditRow(overrides));

describe('toLeadAuditState', () => {
  it('makes values JSON-safe and lists order-independent, so two reads compare by value', () => {
    const result = toLeadAuditState(
      auditRow({
        productQty: new Prisma.Decimal('1.50'),
        actualAmount: new Prisma.Decimal('1200.00'),
        bookingDate: new Date('2026-09-19T00:00:00.000Z'),
        deletedAt: new Date(),
        assignments: [{ userId: 'b' }, { userId: 'a' }],
        tags: [{ tagId: 't2' }, { tagId: 't1' }],
        customFieldValues: [
          { customFieldId: 'f2', value: 'two' },
          { customFieldId: 'f1', value: 'one' },
        ],
        complaints: [{ details: 'Late delivery' }],
      }),
    );

    expect(result).toMatchObject({
      productQty: '1.5',
      actualAmount: '1200',
      bookingDate: '2026-09-19',
      archived: true,
      assigneeIds: ['a', 'b'],
      tagIds: ['t1', 't2'],
      complaint: 'Late delivery',
    });
    expect(JSON.stringify(result.customFields)).toBe('{"f1":"one","f2":"two"}');
  });
});

describe('leadChangeEvents', () => {
  it('records a status change with its old and new value', () => {
    const events = leadChangeEvents(
      LEAD,
      state(),
      state({ status: 'HOT' }),
      context,
    );

    expect(events).toEqual([
      {
        entityType: 'LEAD',
        entityId: LEAD,
        leadId: LEAD,
        action: 'STATUS_CHANGED',
        actor: { type: 'USER', id: 'user-1' },
        source: 'leads.status',
        before: { status: 'New' },
        after: { status: 'HOT' },
        metadata: undefined,
      },
    ]);
  });

  it('marks the move into WON as CONVERTED, keeping the prior status', () => {
    const [event] = leadChangeEvents(
      LEAD,
      state({ status: 'HOT' }),
      state({ status: 'WON' }),
      context,
    );
    expect(event).toMatchObject({
      action: 'CONVERTED',
      before: { status: 'HOT' },
      after: { status: 'WON' },
    });
  });

  it('records leaving WON as a plain status change, not a conversion', () => {
    const [event] = leadChangeEvents(
      LEAD,
      state({ status: 'WON' }),
      state({ status: 'QC NOT APPROVED' }),
      context,
    );
    expect(event.action).toBe('STATUS_CHANGED');
  });

  it('carries the lost reason with a move to LOST', () => {
    const [event] = leadChangeEvents(
      LEAD,
      state({ status: 'HOT' }),
      state({ status: 'LOST', lostReason: 'Price' }),
      context,
    );
    expect(event).toMatchObject({
      action: 'STATUS_CHANGED',
      before: { status: 'HOT', lostReason: null },
      after: { status: 'LOST', lostReason: 'Price' },
    });
  });

  it('records a pipeline move and the status reset it forces as two events', () => {
    const events = leadChangeEvents(
      LEAD,
      state({ status: 'WON' }),
      state({ pipeline: 'LOGISTICS', status: 'Initial' }),
      context,
    );
    expect(events.map((e) => [e.action, e.before, e.after])).toEqual([
      ['STATUS_CHANGED', { status: 'WON' }, { status: 'Initial' }],
      [
        'PIPELINE_CHANGED',
        { pipeline: 'Lead Pipeline' },
        { pipeline: 'LOGISTICS' },
      ],
    ]);
  });

  it.each([
    [[], ['a'], 'ASSIGNED'],
    [['a'], ['a', 'b'], 'ASSIGNED'],
    [['a', 'b'], ['a'], 'UNASSIGNED'],
    [['a'], [], 'UNASSIGNED'],
    [['a'], ['b'], 'REASSIGNED'],
  ])('records assignees %j → %j as %s, with both lists', (was, now, action) => {
    const [event] = leadChangeEvents(
      LEAD,
      state({ assignments: was.map((userId) => ({ userId })) }),
      state({ assignments: now.map((userId) => ({ userId })) }),
      context,
    );
    expect(event).toMatchObject({
      action,
      before: { assigneeIds: was },
      after: { assigneeIds: now },
    });
  });

  it('records archive and restore', () => {
    const archived = leadChangeEvents(
      LEAD,
      state(),
      state({ deletedAt: new Date() }),
      context,
    );
    const restored = leadChangeEvents(
      LEAD,
      state({ deletedAt: new Date() }),
      state(),
      context,
    );
    expect(archived[0]).toMatchObject({
      action: 'ARCHIVED',
      before: { archived: false },
      after: { archived: true },
    });
    expect(restored[0].action).toBe('UNARCHIVED');
  });

  it('groups every other change into one UPDATED event holding only the changed fields', () => {
    const events = leadChangeEvents(
      LEAD,
      state({ city: 'Dubai', tags: [{ tagId: 't1' }] }),
      state({
        city: 'Abu Dhabi',
        tags: [{ tagId: 't1' }, { tagId: 't2' }],
      }),
      context,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'UPDATED',
      before: { city: 'Dubai', tagIds: ['t1'] },
      after: { city: 'Abu Dhabi', tagIds: ['t1', 't2'] },
    });
    expect(Object.keys(events[0].after ?? {})).toEqual(['city', 'tagIds']);
  });

  it('records nothing when nothing changed', () => {
    expect(leadChangeEvents(LEAD, state(), state(), context)).toEqual([]);
  });
});

describe('lead creation and deletion events', () => {
  it('records the full initial state, and the first assignees separately', () => {
    const initial = state({ assignments: [{ userId: 'a' }] });
    const events = leadCreatedEvents(LEAD, initial, {
      ...context,
      metadata: { importJobId: 'job-1' },
    });

    expect(events.map((e) => e.action)).toEqual(['CREATED', 'ASSIGNED']);
    expect(events[0].after).toEqual(initial);
    expect(events[0].before).toBeUndefined();
    expect(events[1]).toMatchObject({
      before: { assigneeIds: [] },
      after: { assigneeIds: ['a'] },
      metadata: { importJobId: 'job-1' },
    });
  });

  it('records no assignment for an unassigned new lead', () => {
    expect(leadCreatedEvents(LEAD, state(), context)).toHaveLength(1);
  });

  it('keeps the last state of a deleted lead, since the row is going away', () => {
    const last = state({ status: 'WON' });
    expect(leadDeletedEvent(LEAD, last, context)).toMatchObject({
      action: 'DELETED',
      before: last,
      after: undefined,
    });
  });

  it('records a refused delete with what held the lead', () => {
    expect(leadDeleteBlockedEvent(LEAD, { calls: 3 }, context)).toMatchObject({
      action: 'DELETE_BLOCKED',
      metadata: { reason: 'LINKED_RECORDS', linked: { calls: 3 } },
    });
  });
});

/** A transaction whose reads return `reads` in order and which records every call made. */
/**
 * A transaction over canned lead reads. `existingOrders` are the leads that already carry a
 * Logistics order — what the converted-lead guards read, and what makes a conversion a no-op.
 */
function makeTx(reads: LeadAuditRow[][], existingOrders: string[] = []) {
  const calls: string[] = [];
  const $queryRaw = jest.fn((...args: unknown[]) => {
    calls.push('lock');
    return Promise.resolve(args);
  });
  const findMany = jest.fn(() => {
    calls.push('read');
    return Promise.resolve(reads.shift() ?? []);
  });
  const createMany = jest.fn(() => {
    calls.push('record');
    return Promise.resolve({ count: 1 });
  });
  const orderFindMany = jest.fn(() => {
    calls.push('orders');
    return Promise.resolve(
      existingOrders.map((leadId) => ({ leadId, id: `order-of-${leadId}` })),
    );
  });
  const createManyAndReturn = jest.fn(
    (args: { data: { leadId: string }[] }) => {
      calls.push('convert');
      // `skipDuplicates` returns only the rows actually inserted: a lead that already has
      // an order is skipped, exactly as ON CONFLICT DO NOTHING skips it.
      return Promise.resolve(
        args.data
          .filter((row) => !existingOrders.includes(row.leadId))
          .map((row, index) => ({
            id: `order-${index + 1}`,
            leadId: row.leadId,
            orderNumber: 1000 + index,
            status: 'INITIAL',
          })),
      );
    },
  );
  const tx = {
    $queryRaw,
    lead: { findMany },
    auditEvent: { createMany },
    logisticsOrder: { findMany: orderFindMany, createManyAndReturn },
  } as unknown as Prisma.TransactionClient;
  const $transaction = jest.fn(
    (run: (client: Prisma.TransactionClient) => Promise<unknown>) => run(tx),
  );
  const prisma = { $transaction } as unknown as PrismaService;
  return {
    prisma,
    tx,
    calls,
    $queryRaw,
    findMany,
    createMany,
    createManyAndReturn,
    $transaction,
  };
}

/** The rows a `recordAuditEvents` call wrote. */
function recorded(createMany: jest.Mock): Record<string, unknown>[] {
  return (createMany.mock.calls[0] as [{ data: Record<string, unknown>[] }])[0]
    .data;
}

describe('auditLeadChanges', () => {
  it('locks, reads, changes, re-reads and records — all in one transaction', async () => {
    const { prisma, calls, createMany, $transaction } = makeTx([
      [auditRow()],
      [auditRow({ status: 'WON' })],
    ]);

    const result = await auditLeadChanges(prisma, [LEAD], context, () => {
      calls.push('change');
      return Promise.resolve('changed');
    });

    expect(result).toBe('changed');
    expect($transaction).toHaveBeenCalledTimes(1);
    // The lead went New → WON, so the conversion asks which leads already have an order and
    // inserts the one that does not — inside the same transaction, before anything is recorded.
    expect(calls).toEqual([
      'lock',
      'read',
      'change',
      'read',
      'orders',
      'convert',
      'record',
    ]);
    expect(recorded(createMany)).toMatchObject([
      { action: 'CONVERTED', actorId: 'user-1', entityId: LEAD },
      { entityType: 'LOGISTICS_ORDER', action: 'CREATED', leadId: LEAD },
    ]);
  });

  it('takes a row lock on exactly the leads it changes', async () => {
    const { prisma, $queryRaw } = makeTx([[], []]);

    await auditLeadChanges(prisma, ['b', 'a'], context, () =>
      Promise.resolve(),
    );

    const [strings, ids] = $queryRaw.mock.calls[0] as [string[], string[]];
    expect(strings.join('?')).toContain('FOR UPDATE');
    expect(strings.join('?')).toContain('ORDER BY id');
    expect(ids).toEqual(['b', 'a']);
  });

  it('records nothing when the change changed nothing', async () => {
    const { prisma, createMany } = makeTx([[auditRow()], [auditRow()]]);

    await auditLeadChanges(prisma, [LEAD], context, () => Promise.resolve());

    expect(createMany).not.toHaveBeenCalled();
  });

  it('leaves no event when the change fails, and surfaces the failure', async () => {
    const { prisma, createMany } = makeTx([[auditRow()]]);
    const failure = new Error('foreign key');

    await expect(
      auditLeadChanges(prisma, [LEAD], context, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('fails the transaction when the event cannot be written, so the change rolls back', async () => {
    const { prisma, createMany } = makeTx([
      [auditRow()],
      [auditRow({ status: 'HOT' })],
    ]);
    createMany.mockImplementation(() =>
      Promise.reject(new Error('audit write failed')),
    );

    await expect(
      auditLeadChanges(prisma, [LEAD], context, () => Promise.resolve()),
    ).rejects.toThrow('audit write failed');
  });
});

describe('recordLeadsCreated', () => {
  it('reads the new leads back through the same transaction and records their creation', async () => {
    const { tx, createMany, findMany } = makeTx([
      [auditRow({ assignments: [{ userId: 'a' }] })],
    ]);

    await recordLeadsCreated(tx, [LEAD], {
      ...context,
      source: 'leads.create',
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    const rows = (
      createMany.mock.calls[0] as unknown as [{ data: unknown[] }]
    )[0].data;
    expect(rows).toMatchObject([
      { action: 'CREATED', source: 'leads.create' },
      { action: 'ASSIGNED', after: { assigneeIds: ['a'] } },
    ]);
  });
});

describe('applyLeadChanges (the caller-transaction form)', () => {
  it('runs the whole sequence in the transaction it is given, opening none of its own', async () => {
    const { tx, calls, createMany, $transaction } = makeTx([
      [auditRow()],
      [auditRow({ status: 'WON' })],
    ]);

    const result = await applyLeadChanges(tx, [LEAD], context, () => {
      calls.push('change');
      return Promise.resolve('changed');
    });

    expect(result).toBe('changed');
    expect($transaction).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'lock',
      'read',
      'change',
      'read',
      'orders',
      'convert',
      'record',
    ]);
    expect(recorded(createMany)).toMatchObject([
      { action: 'CONVERTED', entityId: LEAD },
      { entityType: 'LOGISTICS_ORDER', action: 'CREATED' },
    ]);
  });

  it('is what auditLeadChanges runs inside its transaction', async () => {
    const { prisma, calls, $transaction } = makeTx([
      [auditRow()],
      [auditRow()],
    ]);

    await auditLeadChanges(prisma, [LEAD], context, () => {
      calls.push('change');
      return Promise.resolve();
    });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['lock', 'read', 'change', 'read']);
  });
});

/*
  Phase 3 (ADR-0085): the conversion hook and the converted-lead guards, both enforced in the
  shared change core so no write path can reach a converted lead without passing them.
*/
describe('applyLeadChanges — conversion to a Logistics order', () => {
  const change = () => Promise.resolve();

  it('creates exactly one order for a lead that becomes WON, in the same transaction', async () => {
    const { tx, createManyAndReturn, createMany } = makeTx([
      [auditRow({ status: 'HOT' })],
      [auditRow({ status: 'WON' })],
    ]);

    await applyLeadChanges(tx, [LEAD], context, change);

    const [args] = createManyAndReturn.mock.calls[0] as unknown as [
      { data: Record<string, unknown>[]; skipDuplicates: boolean },
    ];
    expect(args.data).toHaveLength(1);
    expect(args.skipDuplicates).toBe(true);
    // The snapshot is taken from the after-state the core already read: no extra lead read.
    expect(args.data[0]).toMatchObject({
      leadId: LEAD,
      customerName: 'Acme',
      primaryPhone: '971500000000',
    });
    expect(
      recorded(createMany).filter(
        (row) => row.entityType === 'LOGISTICS_ORDER',
      ),
    ).toHaveLength(1);
  });

  it('puts the order id on the CONVERTED event and on no other lead event', async () => {
    const { tx, createMany } = makeTx([
      [auditRow({ status: 'HOT', category: 'Default' })],
      [auditRow({ status: 'WON', category: 'Retail' })],
    ]);

    await applyLeadChanges(tx, [LEAD], context, change);

    const leadEvents = recorded(createMany).filter(
      (row) => row.entityType === 'LEAD',
    );
    const converted = leadEvents.find((row) => row.action === 'CONVERTED');
    expect(converted?.metadata).toEqual({ orderId: 'order-1' });
    // The UPDATED event for the category change rides the same call and must stay clean.
    expect(
      leadEvents.find((row) => row.action === 'UPDATED')?.metadata,
    ).toBeUndefined();
  });

  it('never creates a second order for a lead that already has one', async () => {
    const { tx, createManyAndReturn, createMany } = makeTx(
      [
        [auditRow({ status: 'QC NOT APPROVED' })],
        [auditRow({ status: 'WON' })],
      ],
      [LEAD],
    );

    await applyLeadChanges(tx, [LEAD], context, change, {
      logisticsWriteBack: true,
    });

    // The insert still runs — `skipDuplicates` is what makes it a no-op — and returns nothing,
    // so the existing order is read back and named on the CONVERTED event.
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
    const rows = recorded(createMany);
    expect(rows.filter((row) => row.entityType === 'LOGISTICS_ORDER')).toEqual(
      [],
    );
    expect(rows.find((row) => row.action === 'CONVERTED')?.metadata).toEqual({
      orderId: `order-of-${LEAD}`,
    });
  });

  it('asks the orders table nothing when neither status nor pipeline moved', async () => {
    const { tx, calls } = makeTx([
      [auditRow({ category: 'Default' })],
      [auditRow({ category: 'Retail' })],
    ]);

    await applyLeadChanges(tx, [LEAD], context, change);

    expect(calls).toEqual(['lock', 'read', 'read', 'record']);
  });

  it('converts a lead created as WON, with its own CONVERTED event beside CREATED', async () => {
    const { tx, createMany, createManyAndReturn } = makeTx([
      [auditRow({ status: 'WON' })],
    ]);

    await recordLeadsCreated(tx, [LEAD], context);

    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(recorded(createMany)).toMatchObject([
      { action: 'CREATED', entityId: LEAD },
      { action: 'CONVERTED', entityId: LEAD, metadata: { orderId: 'order-1' } },
      { entityType: 'LOGISTICS_ORDER', action: 'CREATED', leadId: LEAD },
    ]);
  });

  it('leaves a lead created in any other status alone', async () => {
    const { tx, createMany, createManyAndReturn } = makeTx([
      [auditRow({ status: 'New' })],
    ]);

    await recordLeadsCreated(tx, [LEAD], context);

    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(recorded(createMany).map((row) => row.action)).toEqual(['CREATED']);
  });
});

describe('applyLeadChanges — the converted-lead guards', () => {
  const change = () => Promise.resolve();

  it('refuses a status change on a lead that has an order', async () => {
    const { tx, createMany } = makeTx(
      [[auditRow({ status: 'WON' })], [auditRow({ status: 'HOT' })]],
      [LEAD],
    );

    await expect(
      applyLeadChanges(tx, [LEAD], context, change),
    ).rejects.toBeInstanceOf(ConflictException);
    // The 409 rolls the transaction back, so nothing is recorded either.
    expect(createMany).not.toHaveBeenCalled();
  });

  it('lets the Logistics write-back move the same status', async () => {
    const { tx, createMany } = makeTx(
      [
        [auditRow({ status: 'WON' })],
        [auditRow({ status: 'QC NOT APPROVED' })],
      ],
      [LEAD],
    );

    await applyLeadChanges(tx, [LEAD], context, change, {
      logisticsWriteBack: true,
    });

    expect(recorded(createMany)).toMatchObject([{ action: 'STATUS_CHANGED' }]);
  });

  it('refuses moving a converted lead to another pipeline, write-back or not', async () => {
    const { tx } = makeTx(
      [
        [auditRow({ status: 'WON', pipeline: 'Lead Pipeline' })],
        [auditRow({ status: 'WON', pipeline: 'LOGISTICS' })],
      ],
      [LEAD],
    );

    await expect(
      applyLeadChanges(tx, [LEAD], context, change, {
        logisticsWriteBack: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to convert an archived lead', async () => {
    const { tx, createManyAndReturn } = makeTx([
      [auditRow({ status: 'HOT', deletedAt: new Date() })],
      [auditRow({ status: 'WON', deletedAt: new Date() })],
    ]);

    await expect(
      applyLeadChanges(tx, [LEAD], context, change),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  /*
    Only status and pipeline are locked on a converted lead. Every ordinary field — including
    the ones the order's snapshot was copied from — stays editable, which is what makes a
    correction after a QC rejection possible at all. (Whether such a correction should reach
    the order's snapshot is still with the client.)
  */
  it('lets the ordinary fields of a converted lead be corrected', async () => {
    const { tx, createMany } = makeTx(
      [
        [auditRow({ status: 'WON', city: 'Dubai' })],
        [auditRow({ status: 'WON', city: 'Sharjah' })],
      ],
      [LEAD],
    );

    await applyLeadChanges(tx, [LEAD], context, change);

    expect(recorded(createMany)).toMatchObject([
      {
        action: 'UPDATED',
        before: { city: 'Dubai' },
        after: { city: 'Sharjah' },
      },
    ]);
  });

  /*
    Pinned as it stands: archiving is a soft delete of the lead, which the guard does not
    refuse, and it touches no order — there is no path that deletes one. Whether a converted
    lead should be archivable at all is still with the client.
  */
  it('lets a converted lead be archived, and writes no order doing it', async () => {
    const { tx, createMany, createManyAndReturn } = makeTx(
      [
        [auditRow({ status: 'WON' })],
        [auditRow({ status: 'WON', deletedAt: new Date() })],
      ],
      [LEAD],
    );

    await applyLeadChanges(tx, [LEAD], context, change);

    expect(recorded(createMany)).toMatchObject([
      {
        action: 'ARCHIVED',
        before: { archived: false },
        after: { archived: true },
      },
    ]);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('leaves an unconverted lead free to move pipeline', async () => {
    const { tx, createMany } = makeTx([
      [auditRow({ pipeline: 'Lead Pipeline' })],
      [auditRow({ pipeline: 'Complaints' })],
    ]);

    await applyLeadChanges(tx, [LEAD], context, change);

    expect(recorded(createMany)).toMatchObject([
      { action: 'PIPELINE_CHANGED' },
    ]);
  });
});
