import { Prisma } from '../generated/prisma/client';
import { retainedLeads } from './lead-retention';

const LEAD_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEAD_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface RetentionRow {
  id: string;
  _count: { calls: number };
  logisticsOrder: { id: string } | null;
}

function makeTx(rows: RetentionRow[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const tx = { lead: { findMany } } as unknown as Prisma.TransactionClient;
  return { tx, findMany };
}

const row = (id: string, over: Partial<RetentionRow> = {}): RetentionRow => ({
  id,
  _count: { calls: 0 },
  logisticsOrder: null,
  ...over,
});

/**
 * The delete guard's rule (ADR-0083, extended by ADR-0085 B15): a lead that other business
 * records depend on is never hard-deleted. Calls held it first; a Logistics order now holds it
 * too, which is what keeps a converted lead — and the order's history — in place.
 */
describe('retainedLeads', () => {
  it('names the leads that carry calls, with their count', async () => {
    const { tx, findMany } = makeTx([row(LEAD_A, { _count: { calls: 3 } })]);

    const retained = await retainedLeads(tx, [LEAD_A, LEAD_B]);

    expect([...retained]).toEqual([[LEAD_A, { calls: 3, logisticsOrder: 0 }]]);
    const args = (findMany.mock.calls[0] as [Prisma.LeadFindManyArgs])[0];
    expect(args.where).toEqual({
      id: { in: [LEAD_A, LEAD_B] },
      OR: [{ calls: { some: {} } }, { logisticsOrder: { isNot: null } }],
    });
  });

  it('holds back a converted lead even when it has no calls at all', async () => {
    const { tx } = makeTx([row(LEAD_A, { logisticsOrder: { id: 'order-1' } })]);

    const retained = await retainedLeads(tx, [LEAD_A]);

    expect(retained.get(LEAD_A)).toEqual({ calls: 0, logisticsOrder: 1 });
  });

  it('holds nothing back when a selected lead has neither', async () => {
    const { tx } = makeTx([]);

    expect((await retainedLeads(tx, [LEAD_A])).size).toBe(0);
  });

  it('asks the database nothing for an empty selection', async () => {
    const { tx, findMany } = makeTx([]);

    expect((await retainedLeads(tx, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
