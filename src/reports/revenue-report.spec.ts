import { Prisma, UserRole } from '../generated/prisma/client';
import {
  buildPipelineRows,
  buildSourceRows,
  dealPage,
  figureChanges,
  groupOf,
  NO_GROUP_LABEL,
  orderDeals,
  percentChange,
  percentOf,
  periodTarget,
  revenueFigures,
  roleLabel,
  sumTallies,
  tally,
  winRate,
  type DealLine,
  type Tally,
} from './revenue-report';

const dec = (value: string | number) => new Prisma.Decimal(value);
const t = (count: number, amount: string | number): Tally => ({
  count,
  amount: dec(amount),
});

let seq = 0;
function line(overrides: Partial<DealLine> = {}): DealLine {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name: `Lead ${seq}`,
    pipeline: 'Lead Pipeline',
    status: 'WON',
    actualAmount: dec(100),
    secondaryPhone: null,
    product: null,
    language: null,
    country: null,
    source: null,
    statusChangedAt: new Date('2026-10-10T08:00:00.000Z'),
    assignees: [],
    ...overrides,
  };
}

describe('percentOf / percentChange / winRate', () => {
  it('divides to two places and has no answer without a base', () => {
    // Workpex's Conversion Rate card: 2,382 of 8,477 leads.
    expect(percentOf(2382, 8477)).toBe(28.1);
    expect(percentOf(1, 3)).toBe(33.33);
    expect(percentOf(5, 0)).toBeNull();
  });

  it('reports change on the prior figure, and none from zero or without one', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(0, 100)).toBe(-100);
    // Workpex's Reorder row: 26,309 against 318 the quarter before.
    expect(percentChange(dec(26309), dec(318))).toBe(8173.27);
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
  });

  it('wins ÷ closed deals — Workpex’s 81.6 % pipeline win rate', () => {
    expect(winRate(2382, 537)).toBe(81.6);
    expect(winRate(0, 4)).toBe(0);
    expect(winRate(0, 0)).toBeNull();
  });
});

describe('revenueFigures', () => {
  it('averages over every deal, valued or not — Workpex’s 293,853 ÷ 2,382', () => {
    expect(
      revenueFigures(t(2382, '293853'), { leads: 8477, won: 2382 }),
    ).toEqual({
      revenue: '293853.00',
      deals: 2382,
      avgDealValue: '123.36',
      conversionRate: 28.1,
    });
  });

  it('has no average or rate with nothing to divide', () => {
    expect(revenueFigures(t(0, 0), { leads: 0, won: 0 })).toEqual({
      revenue: '0.00',
      deals: 0,
      avgDealValue: null,
      conversionRate: null,
    });
  });

  it('changes are all null without a comparison window', () => {
    const current = revenueFigures(t(3, 300), { leads: 10, won: 3 });
    expect(figureChanges(current, null)).toEqual({
      revenue: null,
      deals: null,
      avgDealValue: null,
      conversionRate: null,
    });
    const prior = revenueFigures(t(2, 100), { leads: 10, won: 2 });
    expect(figureChanges(current, prior)).toEqual({
      revenue: 200,
      deals: 50,
      avgDealValue: 100,
      conversionRate: 50,
    });
  });
});

describe('periodTarget', () => {
  it('is the monthly goals times whole months, uncapped — Workpex’s 1737 %', () => {
    expect(periodTarget(dec(5640), 3, dec(293853))).toEqual({
      monthly: '5640.00',
      months: 3,
      period: '16920.00',
      percent: 1736.72,
    });
  });

  it('has no period target for a part-month window, but keeps the monthly line', () => {
    expect(periodTarget(dec(5640), undefined, dec(100))).toEqual({
      monthly: '5640.00',
      months: null,
      period: null,
      percent: null,
    });
  });

  it('is no target — not 0 % — when no member has a goal', () => {
    for (const goals of [null, dec(0)]) {
      expect(periodTarget(goals, 3, dec(100))).toEqual({
        monthly: null,
        months: 3,
        period: null,
        percent: null,
      });
    }
  });
});

describe('the breakdowns', () => {
  it('folds a missing and a blank source into one "No Source"', () => {
    const folded = tally([
      { label: 'No Source', count: 2, amount: dec(10) },
      { label: 'No Source', count: 1, amount: null },
      { label: 'Broadcast', count: 4, amount: dec(40) },
    ]);
    expect(folded.get('No Source')).toEqual(t(3, 10));
    expect(sumTallies(folded)).toEqual(t(7, 50));
  });

  it('lists every source with a deal, highest revenue first, and adds up to the total', () => {
    const deals = new Map([
      ['Reorder', t(2, 26309)],
      ['DoubleTick', t(5, 237957)],
      ['No Source', t(1, 0)],
    ]);
    const rows = buildSourceRows({
      deals,
      prior: new Map([['Reorder', t(3, 318)]]),
      created: new Map([
        ['DoubleTick', t(20, 0)],
        ['Reorder', t(4, 0)],
      ]),
      createdWon: new Map([['DoubleTick', t(5, 0)]]),
    });

    expect(rows.map((row) => row.source)).toEqual([
      'DoubleTick',
      'Reorder',
      'No Source',
    ]);
    expect(rows[0]).toMatchObject({
      revenue: '237957.00',
      deals: 5,
      conversionRate: 25,
      priorRevenue: '0.00',
      change: null,
    });
    expect(rows[1]).toMatchObject({
      conversionRate: 0,
      priorRevenue: '318.00',
      change: 8173.27,
    });
    // Closed in the window, but none of its leads was created in it: no rate to show.
    expect(rows[2].conversionRate).toBeNull();
    expect(
      rows.reduce((sum, row) => sum.plus(row.revenue), dec(0)).toFixed(2),
    ).toBe(sumTallies(deals).amount.toFixed(2));
  });

  it('has no prior column without a comparison window', () => {
    const [row] = buildSourceRows({
      deals: new Map([['Broadcast', t(1, 50)]]),
      prior: null,
      created: new Map(),
      createdWon: new Map(),
    });
    expect(row).toMatchObject({ priorRevenue: null, change: null });
  });

  it('keeps a pipeline that only lost deals, at a 0 % win rate', () => {
    const rows = buildPipelineRows(
      new Map([['Lead Pipeline', t(2382, 293853)]]),
      new Map([
        ['Lead Pipeline', t(537, 0)],
        ['Complaints', t(2, 0)],
      ]),
    );
    expect(rows).toEqual([
      {
        pipeline: 'Lead Pipeline',
        revenue: '293853.00',
        deals: 2382,
        lost: 537,
        winRate: 81.6,
      },
      {
        pipeline: 'Complaints',
        revenue: '0.00',
        deals: 0,
        lost: 2,
        winRate: 0,
      },
    ]);
  });
});

describe('the Data Grid', () => {
  it('names a member’s role by their organisational role, else the base role', () => {
    expect(roleLabel(UserRole.SALES_AGENT, 'BDE')).toBe('BDE');
    expect(roleLabel(UserRole.SALES_AGENT, null)).toBe('Sales Agent');
    expect(roleLabel(UserRole.QC, ' ')).toBe('QC');
  });

  it('groups a co-assigned deal once, under its assignees together', () => {
    const deal = line({
      assignees: [
        { name: 'NIHAD V P', role: 'Sales Agent' },
        { name: 'Ansar UAE', role: 'Sales Manager' },
      ],
    });
    expect(groupOf('agent', deal)).toEqual({
      key: 'agent:Ansar UAE, NIHAD V P',
      label: 'Ansar UAE, NIHAD V P',
    });
    expect(groupOf('role', deal).label).toBe('Sales Agent, Sales Manager');
  });

  it('puts the deals with nothing in the field under OTHER — and never mixes it with a real "OTHER"', () => {
    const none = groupOf('agent', line());
    const named = groupOf(
      'agent',
      line({ assignees: [{ name: 'OTHER', role: 'Sales Agent' }] }),
    );
    expect(none.label).toBe(NO_GROUP_LABEL);
    expect(named.label).toBe('OTHER');
    expect(none.key).not.toBe(named.key);
    expect(groupOf('source', line({ source: '  ' })).label).toBe('No Source');
    expect(groupOf('pipeline', line()).key).toBe('pipeline:Lead Pipeline');
  });

  it('orders the largest group first, then the column, empties last either way', () => {
    const lines = [
      line({ country: 'Oman', source: 'Broadcast' }),
      line({ country: 'Bahrain', source: 'DoubleTick' }),
      line({ country: 'Qatar', source: 'DoubleTick' }),
      line({ country: null, source: 'DoubleTick' }),
      line({ country: ' ', source: 'DoubleTick' }),
    ];
    const countries = (direction: 'asc' | 'desc') =>
      orderDeals(lines, {
        group: 'source',
        sort: 'country',
        direction,
      }).entries.map((entry) => [entry.group?.label, entry.line.country]);
    expect(countries('asc').slice(0, 2)).toEqual([
      ['DoubleTick', 'Bahrain'],
      ['DoubleTick', 'Qatar'],
    ]);
    expect(countries('desc').slice(0, 2)).toEqual([
      ['DoubleTick', 'Qatar'],
      ['DoubleTick', 'Bahrain'],
    ]);
    for (const direction of ['asc', 'desc'] as const) {
      const order = countries(direction);
      expect(
        order.slice(2, 4).map(([, country]) => country?.trim() ?? ''),
      ).toEqual(['', '']);
      expect(order[4]).toEqual(['Broadcast', 'Oman']);
    }
  });

  it('sorts amounts by value and text naturally', () => {
    const lines = [
      line({ actualAmount: dec(99) }),
      line({ actualAmount: dec(1000) }),
      line({ actualAmount: null }),
      line({ actualAmount: dec(145) }),
    ];
    const amounts = orderDeals(lines, {
      group: 'none',
      sort: 'actualAmount',
      direction: 'desc',
    }).entries.map((entry) => entry.line.actualAmount?.toNumber() ?? null);
    expect(amounts).toEqual([1000, 145, 99, null]);

    const named = orderDeals(
      [line({ name: 'Lead 10' }), line({ name: 'lead 9' })],
      { group: 'none', sort: 'name' },
    ).entries.map((entry) => entry.line.name);
    expect(named).toEqual(['lead 9', 'Lead 10']);
  });

  it('breaks ties by the newest conversion, then the id, so pages never overlap', () => {
    const older = line({ statusChangedAt: new Date('2026-10-01T00:00:00Z') });
    const newer = line({ statusChangedAt: new Date('2026-10-02T00:00:00Z') });
    const twinA = line({ statusChangedAt: new Date('2026-09-01T00:00:00Z') });
    const twinB = line({ statusChangedAt: new Date('2026-09-01T00:00:00Z') });
    const order = orderDeals([twinB, older, twinA, newer], {
      group: 'none',
      sort: 'status',
    });
    expect(order.entries.map((entry) => entry.line.id)).toEqual([
      newer.id,
      older.id,
      twinA.id,
      twinB.id,
    ]);
  });

  it('pages through the order with each group’s full count, on every page it spans', () => {
    const lines = [
      ...Array.from({ length: 3 }, () => line({ source: 'DoubleTick' })),
      line({ source: 'Broadcast' }),
    ];
    const order = orderDeals(lines, { group: 'source' });
    expect(dealPage(order, 1, 2).groups).toEqual([
      { key: 'source:DoubleTick', label: 'DoubleTick', count: 3 },
    ]);
    const second = dealPage(order, 2, 2);
    expect(second.groups).toEqual([
      { key: 'source:DoubleTick', label: 'DoubleTick', count: 3 },
      { key: 'source:Broadcast', label: 'Broadcast', count: 1 },
    ]);
    expect(second.entries).toHaveLength(2);
    expect(dealPage(order, 3, 2).entries).toEqual([]);
    expect(dealPage(orderDeals(lines, { group: 'none' }), 1, 2).groups).toEqual(
      [],
    );
  });
});
