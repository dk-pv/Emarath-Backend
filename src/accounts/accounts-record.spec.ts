import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { openAccountsRecord } from './accounts-record';

const ORDER = '33333333-3333-3333-3333-333333333333';
const LEAD = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const RECORD = '44444444-4444-4444-4444-444444444444';

function makeTx(create: jest.Mock) {
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    accountsRecord: { create },
    auditEvent: { createMany: auditCreateMany },
  } as unknown as Prisma.TransactionClient;
  return { tx, auditCreateMany };
}

describe('openAccountsRecord', () => {
  it('opens an INITIAL record for the order and records it on the lead’s journey', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: RECORD, status: 'INITIAL' });
    const { tx, auditCreateMany } = makeTx(create);

    await openAccountsRecord(
      tx,
      { id: ORDER, leadId: LEAD },
      { type: 'USER', id: USER },
      'logistics.deliver',
    );

    expect(create).toHaveBeenCalledWith({
      data: { orderId: ORDER },
      select: { id: true, status: true },
    });
    expect(auditCreateMany).toHaveBeenCalledWith({
      data: [
        {
          entityType: 'ACCOUNTS_RECORD',
          entityId: RECORD,
          leadId: LEAD,
          action: 'ACCOUNTS_CREATED',
          actorType: 'USER',
          actorId: USER,
          source: 'logistics.deliver',
          before: undefined,
          after: { status: 'INITIAL' },
          metadata: { orderId: ORDER },
        },
      ],
    });
  });

  it('refuses a second record for the order with a 409, writing no event', async () => {
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const { tx, auditCreateMany } = makeTx(create);

    const attempt = openAccountsRecord(
      tx,
      { id: ORDER, leadId: LEAD },
      { type: 'USER', id: USER },
      'logistics.deliver',
    );

    await expect(attempt).rejects.toThrow(
      new ConflictException(
        'This order already has an Accounts record, so the delivery was not recorded.',
      ),
    );
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('passes any other failure through unchanged', async () => {
    const failure = new Error('connection lost');
    const { tx } = makeTx(jest.fn().mockRejectedValue(failure));

    await expect(
      openAccountsRecord(
        tx,
        { id: ORDER, leadId: LEAD },
        { type: 'USER', id: USER },
        'logistics.deliver',
      ),
    ).rejects.toBe(failure);
  });
});

/*
  The Accounts migration may only add: its own type, its own table, that table's indexes and its
  key to logistics_orders. It must leave activities.completion_note and the GPS objects alone (both
  are drift the shared database carries), and backfill nothing — an owner decision still open.
*/
describe('the Accounts migration', () => {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  const folders = readdirSync(dir)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();
  const name = folders.find((entry) => entry.endsWith('_accounts_records'));
  const sql = readFileSync(join(dir, name ?? '', 'migration.sql'), 'utf8');
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('creates the payment status type, the records table, its indexes and its key', () => {
    expect(statements).toContain(
      `CREATE TYPE "PaymentStatus" AS ENUM ('INITIAL', 'PAYMENT_PENDING', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'PARTIALLY_PAID');`,
    );
    expect(statements).toContain('CREATE TABLE "accounts_records"');
    expect(statements).toContain(
      'CREATE UNIQUE INDEX "accounts_records_order_id_key" ON "accounts_records"("order_id");',
    );
    expect(statements).toContain(
      'REFERENCES "logistics_orders"("id") ON DELETE RESTRICT',
    );
  });

  it('drops, deletes, rewrites and backfills nothing', () => {
    for (const forbidden of [
      /\bDROP\b/,
      /\bDELETE FROM\b/,
      /\bUPDATE "/,
      /\bINSERT INTO\b/,
      /\bTRUNCATE\b/,
      /\bALTER COLUMN\b/,
      /\bALTER TYPE\b/,
      /completion_note/,
    ]) {
      expect(statements).not.toMatch(forbidden);
    }
  });

  it('alters no table but its own', () => {
    const altered = [...statements.matchAll(/ALTER TABLE "(\w+)"/g)].map(
      (match) => match[1],
    );
    expect([...new Set(altered)]).toEqual(['accounts_records']);
  });

  // Why it cannot reach a database through `migrate deploy` while the GPS removal is pending.
  it('sorts after the pending GPS removal and the delivery date', () => {
    expect(name).toBeDefined();
    expect(folders).toContain('20261008120000_remove_gps_module');
    expect(folders.indexOf(name!)).toBeGreaterThan(
      folders.indexOf('20261015120000_logistics_delivery_date'),
    );
    expect(
      folders.indexOf('20261015120000_logistics_delivery_date'),
    ).toBeGreaterThan(folders.indexOf('20261008120000_remove_gps_module'));
  });
});
