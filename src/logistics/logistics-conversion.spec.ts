import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { userActor } from '../audit/audit-events';
import {
  ConvertibleLeadState,
  DELIVERY_DATE_NOT_CONVERTING_MESSAGE,
  DELIVERY_DATE_REQUIRED_MESSAGE,
  becameConverted,
  convertLeadsToOrders,
  requestedDeliveryDate,
} from './logistics-conversion';

const LEAD_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEAD_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** The business day the requests below are measured on: 17 Oct 2026 in Dubai. */
const BUSINESS_DAY = {
  timeZone: 'Asia/Dubai',
  today: '2026-10-17',
  tomorrow: '2026-10-18',
};
/** A converting request: it carries the requested delivery day (client, 2026-10-17). */
const context = {
  actor: userActor({ id: 'user-1' }),
  source: 'leads.status',
  deliveryDate: { day: '2026-10-20', businessDay: BUSINESS_DAY },
};
/** A request that carries no date — the Logistics write-backs, and every non-converting write. */
const undated = { actor: userActor({ id: 'user-1' }), source: 'leads.status' };

const state = (
  overrides: Partial<ConvertibleLeadState> = {},
): ConvertibleLeadState => ({
  status: 'WON',
  archived: false,
  name: 'Acme Trading',
  primaryPhone: '971500000000',
  secondaryPhone: null,
  email: null,
  country: 'AE',
  state: 'Dubai',
  city: 'Dubai',
  street: 'Sheikh Zayed Rd',
  nationalCode: null,
  product: 'Water filter',
  productQty: '2',
  product2: null,
  product2Qty: null,
  actualAmount: '1500.50',
  paymentMethod: 'Cash on Delivery',
  ...overrides,
});

/** `existing` are the leads that already have an order, which the insert then skips. */
function makeTx(existing: string[] = []) {
  const createManyAndReturn = jest.fn((args: { data: { leadId: string }[] }) =>
    Promise.resolve(
      args.data
        .filter((row) => !existing.includes(row.leadId))
        .map((row, index) => ({
          id: `order-${index + 1}`,
          leadId: row.leadId,
          orderNumber: 1000 + index,
          status: 'INITIAL',
        })),
    ),
  );
  const findMany = jest.fn(() =>
    Promise.resolve(
      existing.map((leadId) => ({ id: `kept-${leadId}`, leadId })),
    ),
  );
  const tx = {
    logisticsOrder: { createManyAndReturn, findMany },
  } as unknown as Prisma.TransactionClient;
  return { tx, createManyAndReturn, findMany };
}

describe('becameConverted', () => {
  it('is true only when the lead arrives at WON from something else', () => {
    expect(becameConverted({ status: 'HOT' }, { status: 'WON' })).toBe(true);
    expect(becameConverted({ status: 'WON' }, { status: 'WON' })).toBe(false);
    expect(becameConverted({ status: 'WON' }, { status: 'LOST' })).toBe(false);
    expect(becameConverted({ status: 'HOT' }, { status: 'HOT' })).toBe(false);
  });

  it('treats a lead created as WON as a conversion, and any other status as not', () => {
    expect(becameConverted(undefined, { status: 'WON' })).toBe(true);
    expect(becameConverted(undefined, { status: 'New' })).toBe(false);
  });

  it('matches the status exactly, so a look-alike never converts', () => {
    expect(becameConverted({ status: 'New' }, { status: 'won' })).toBe(false);
    expect(becameConverted({ status: 'New' }, { status: 'WON ' })).toBe(false);
    expect(becameConverted({ status: 'New' }, { status: 'Converted' })).toBe(
      false,
    );
  });

  /*
    CD-5: no historical backfill. An existing WON lead is only ever seen as WON → WON by every
    write path, so nothing in the system can hand it an order retrospectively.
  */
  it('never converts a lead that was already WON before the workflow existed', () => {
    expect(becameConverted({ status: 'WON' }, { status: 'WON' })).toBe(false);
  });
});

describe('convertLeadsToOrders', () => {
  it('copies the lead’s after-state onto the order as a snapshot', async () => {
    const { tx, createManyAndReturn } = makeTx();

    await convertLeadsToOrders(tx, [{ id: LEAD_A, state: state() }], context);

    const [args] = createManyAndReturn.mock.calls[0] as unknown as [
      { data: Record<string, unknown>[]; skipDuplicates: boolean },
    ];
    expect(args.data[0]).toMatchObject({
      leadId: LEAD_A,
      convertedById: 'user-1',
      // Two columns are named for the order, not the lead.
      customerName: 'Acme Trading',
      orderValue: '1500.50',
      productQty: '2',
      paymentMethod: 'Cash on Delivery',
      city: 'Dubai',
    });
    expect(args.data[0].convertedAt).toBeInstanceOf(Date);
    expect(args.skipDuplicates).toBe(true);
  });

  it('records the order’s creation and its requested date, once per order actually inserted', async () => {
    const { tx } = makeTx();

    const { events, orderIdByLead } = await convertLeadsToOrders(
      tx,
      [
        { id: LEAD_A, state: state() },
        { id: LEAD_B, state: state({ name: 'Beta' }) },
      ],
      context,
    );

    expect(orderIdByLead.get(LEAD_A)).toBe('order-1');
    expect(events.map((event) => [event.leadId, event.action])).toEqual([
      [LEAD_A, 'CREATED'],
      [LEAD_A, 'UPDATED'],
      [LEAD_B, 'CREATED'],
      [LEAD_B, 'UPDATED'],
    ]);
    expect(events[0]).toMatchObject({
      entityType: 'LOGISTICS_ORDER',
      entityId: 'order-1',
      leadId: LEAD_A,
      action: 'CREATED',
      actor: { type: 'USER', id: 'user-1' },
      source: 'leads.status',
      after: {
        orderNumber: 1000,
        status: 'INITIAL',
        customerName: 'Acme Trading',
      },
    });
    // The snapshot stays the lead's copy; the date is Sales' own event, not part of it.
    expect(events[0].after).not.toHaveProperty('deliveryDate');
    expect(events[1]).toEqual({
      entityType: 'LOGISTICS_ORDER',
      entityId: 'order-1',
      leadId: LEAD_A,
      action: 'UPDATED',
      actor: { type: 'USER', id: 'user-1' },
      source: 'logistics.delivery_date',
      before: { deliveryDate: null },
      after: { deliveryDate: '2026-10-20' },
    });
  });

  /*
    CD-2: one lead, one order, ever. `skipDuplicates` over the UNIQUE lead_id is what makes a
    repeated conversion — a retry, a re-conversion after a QC rejection, two writers racing —
    keep the order the lead already has instead of creating a second one or failing. The
    Logistics write-backs that make a lead WON again carry no date, and need none.
  */
  it('keeps the order a lead already has, and records no second creation', async () => {
    const { tx, findMany } = makeTx([LEAD_A]);

    const { events, orderIdByLead } = await convertLeadsToOrders(
      tx,
      [{ id: LEAD_A, state: state() }],
      undated,
    );

    expect(events).toEqual([]);
    expect(orderIdByLead.get(LEAD_A)).toBe(`kept-${LEAD_A}`);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('converts the one lead of a batch that is new and keeps the other’s order', async () => {
    const { tx } = makeTx([LEAD_B]);

    const { events, orderIdByLead } = await convertLeadsToOrders(
      tx,
      [
        { id: LEAD_A, state: state() },
        { id: LEAD_B, state: state() },
      ],
      context,
    );

    expect([...new Set(events.map((event) => event.leadId))]).toEqual([LEAD_A]);
    expect(orderIdByLead.get(LEAD_B)).toBe(`kept-${LEAD_B}`);
  });

  /*
    Every new order must have a delivery date (client, 2026-10-17): the day the converting request
    carries is stored on the order in the same insert — never the Booking Date, never today by
    default. The double has no update method, so a second write would fail these tests.
  */
  it('stores the requested day on the new order, in the insert itself', async () => {
    const { tx, createManyAndReturn } = makeTx();

    await convertLeadsToOrders(tx, [{ id: LEAD_A, state: state() }], context);

    const [args] = createManyAndReturn.mock.calls[0] as unknown as [
      { data: Record<string, unknown>[] },
    ];
    expect(args.data[0].deliveryDate).toEqual(
      new Date('2026-10-20T00:00:00.000Z'),
    );
    expect(args.data[0]).not.toHaveProperty('bookingDate');
  });

  it('gives a converted duplicate its own dated order and leaves the original’s order alone', async () => {
    const { tx, createManyAndReturn } = makeTx([LEAD_A]);

    const { events, orderIdByLead } = await convertLeadsToOrders(
      tx,
      [{ id: LEAD_B, state: state() }],
      context,
    );

    const [args] = createManyAndReturn.mock.calls[0] as unknown as [
      { data: Record<string, unknown>[]; skipDuplicates: boolean },
    ];
    expect(args.data.map((row) => row.leadId)).toEqual([LEAD_B]);
    expect(args.skipDuplicates).toBe(true);
    expect([...new Set(events.map((event) => event.leadId))]).toEqual([LEAD_B]);
    expect(orderIdByLead.has(LEAD_A)).toBe(false);
  });

  it('records a system conversion with no converting user', async () => {
    const { tx, createManyAndReturn } = makeTx();

    await convertLeadsToOrders(tx, [{ id: LEAD_A, state: state() }], {
      actor: { type: 'SYSTEM' },
      source: 'leads.import',
      deliveryDate: context.deliveryDate,
    });

    const [args] = createManyAndReturn.mock.calls[0] as unknown as [
      { data: { convertedById: string | null }[] },
    ];
    expect(args.data[0].convertedById).toBeNull();
  });

  it('asks the database nothing when no lead converted', async () => {
    const { tx, createManyAndReturn, findMany } = makeTx();

    const result = await convertLeadsToOrders(tx, [], undated);

    expect(result).toEqual({ orderIdByLead: new Map(), events: [] });
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('convertLeadsToOrders — the delivery date a new order must have', () => {
  it('refuses a new order without a date with a 400, so the transaction rolls back', async () => {
    const { tx } = makeTx();

    const attempt = convertLeadsToOrders(
      tx,
      [{ id: LEAD_A, state: state() }],
      undated,
    );

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(DELIVERY_DATE_REQUIRED_MESSAGE);
  });

  it.each([
    [
      'a day before today in Dubai',
      '2026-10-16',
      'The delivery date can’t be before today, 17-10-2026 (Asia/Dubai).',
    ],
    [
      'a day that does not exist',
      '2026-02-30',
      'Delivery Date must be a real date written YYYY-MM-DD (years 2000-2099)',
    ],
    [
      'another format',
      '20-10-2026',
      'Delivery Date must be a real date written YYYY-MM-DD (years 2000-2099)',
    ],
  ])('refuses %s before inserting anything', async (_label, day, message) => {
    const { tx, createManyAndReturn } = makeTx();

    const attempt = convertLeadsToOrders(tx, [{ id: LEAD_A, state: state() }], {
      ...undated,
      deliveryDate: { day, businessDay: BUSINESS_DAY },
    });

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(message);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('accepts today itself', async () => {
    const { tx, createManyAndReturn } = makeTx();

    await convertLeadsToOrders(tx, [{ id: LEAD_A, state: state() }], {
      ...undated,
      deliveryDate: { day: '2026-10-17', businessDay: BUSINESS_DAY },
    });

    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it('refuses a date on a request that converts nothing', async () => {
    const empty = makeTx();
    await expect(convertLeadsToOrders(empty.tx, [], context)).rejects.toThrow(
      DELIVERY_DATE_NOT_CONVERTING_MESSAGE,
    );
    expect(empty.createManyAndReturn).not.toHaveBeenCalled();

    // Every lead already has its order: no new order, so the date has nowhere to go.
    const kept = makeTx([LEAD_A]);
    await expect(
      convertLeadsToOrders(kept.tx, [{ id: LEAD_A, state: state() }], context),
    ).rejects.toThrow(DELIVERY_DATE_NOT_CONVERTING_MESSAGE);
  });
});

describe('requestedDeliveryDate', () => {
  const config = {
    getOrThrow: () => ({ businessTimeZone: 'Asia/Dubai' }),
  } as unknown as ConfigService;

  it('is nothing when the request carries no date', () => {
    expect(requestedDeliveryDate(undefined, config)).toBeUndefined();
  });

  it('measures the day against today in the business timezone', () => {
    const requested = requestedDeliveryDate('2026-10-20', config);
    expect(requested?.day).toBe('2026-10-20');
    expect(requested?.businessDay.timeZone).toBe('Asia/Dubai');
    expect(requested?.businessDay.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/*
  CD-5 and the client's "keep legacy stages and tags as historical data": the migration may
  only add. A later edit that touched leads, stages or tags would be caught here.
*/
describe('the Logistics migration', () => {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  const name = readdirSync(dir).find((entry) =>
    entry.endsWith('_add_logistics_orders'),
  );
  const sql = readFileSync(join(dir, name ?? '', 'migration.sql'), 'utf8');

  it('only creates: no data is written, moved or removed', () => {
    expect(sql).toContain('CREATE TABLE "logistics_orders"');
    expect(sql).toContain('CREATE TYPE "LogisticsStatus"');
    // Statement forms, not bare words: `ON DELETE RESTRICT` is part of the new key.
    for (const forbidden of [
      /\bDROP\b/,
      /\bDELETE FROM\b/,
      /\bUPDATE "/,
      /\bINSERT INTO\b/,
      /\bTRUNCATE\b/,
      /\bALTER COLUMN\b/,
    ]) {
      expect(sql).not.toMatch(forbidden);
    }
  });

  it('leaves every existing table alone', () => {
    const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map(
      (match) => match[1],
    );
    expect([...new Set(altered)]).toEqual(['logistics_orders']);
  });

  /*
    This migration only indexed the AWB. Uniqueness (client Q9, 2026-10-01) came later, in its
    own additive migration — pinned in the describe below — and this file is never edited.
  */
  it('indexes the AWB without making it unique', () => {
    expect(sql).toContain('CREATE INDEX "logistics_orders_awb_number_idx"');
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^\n]*awb_number/);
  });

  it('gives an order at most one lead, and the lead’s row protection', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "logistics_orders_lead_id_key"');
    expect(sql).toContain('REFERENCES "leads"("id") ON DELETE RESTRICT');
  });
});

/*
  The 2026-10-01 clarification's migration, as applied to the dev database: the QC role (Q1) and
  a unique AWB (Q9), purely additive. An early draft dropped the plain AWB index; that draft was
  never applied, and CLAUDE.md §11 puts any schema drop behind explicit approval — so a DROP here
  is a failure, and no later migration may remove either AWB index.
*/
describe('the QC role and unique AWB migration', () => {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  // Migration folders only — the directory also holds migration_lock.toml.
  const entries = readdirSync(dir)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();
  const name = entries.find((entry) =>
    entry.endsWith('_qc_role_and_unique_awb'),
  );
  const sql = readFileSync(join(dir, name ?? '', 'migration.sql'), 'utf8');

  it('adds the QC role and a unique AWB index', () => {
    expect(sql).toContain(`ALTER TYPE "UserRole" ADD VALUE 'QC'`);
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "logistics_orders_awb_number_key" ON "logistics_orders"("awb_number")',
    );
  });

  it('drops, deletes and rewrites nothing — the plain AWB index stays', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    for (const forbidden of [
      /\bDROP\b/,
      /\bDELETE FROM\b/,
      /\bUPDATE "/,
      /\bINSERT INTO\b/,
      /\bTRUNCATE\b/,
      /\bALTER COLUMN\b/,
    ]) {
      expect(statements).not.toMatch(forbidden);
    }
  });

  it('is not undone by any later migration', () => {
    const later = entries.slice(entries.indexOf(name ?? '') + 1);
    for (const entry of later) {
      const next = readFileSync(join(dir, entry, 'migration.sql'), 'utf8');
      expect(next).not.toMatch(/DROP INDEX[^\n]*logistics_orders_awb_number/);
    }
  });
});
