import { Prisma } from '../generated/prisma/client';
import type { StageProgression } from './sales-funnel-progression';
import {
  buildSalesFunnelReport,
  type FunnelStage,
  type SalesFunnelInput,
} from './sales-funnel-report';

let next = 0;
const stage = (
  name: string,
  extra: Partial<FunnelStage> = {},
): FunnelStage => ({
  id: `stage-${++next}`,
  name,
  color: 'violet',
  isClosed: false,
  outcome: null,
  inclusion: 'INCLUDE_IN_SALES_PIPELINE',
  probability: 0,
  ...extra,
});
const closed = (name: string, outcome: string) =>
  stage(name, { isClosed: true, outcome });

/** Workpex's Lead Pipeline order: open stages, then the closed ones (LOST among them). */
const STAGES: FunnelStage[] = [
  stage('New'),
  stage('Initial Contact'),
  stage('Warm', { probability: 50 }),
  stage('Hidden', { inclusion: 'EXCLUDE_FROM_SALES_PIPELINE' }),
  closed('WON', 'WON'),
  closed('Converted', 'WON'),
  closed('LOST', 'LOST'),
  closed('ON HOLD SHIP', 'WON'),
];

const counts = (
  rows: Record<string, [number, string]>,
): Map<string, StageProgression> =>
  new Map(
    Object.entries(rows).map(([name, [count, value]]) => [
      name,
      { count, value: new Prisma.Decimal(value) },
    ]),
  );

/** The Oct 2026 capture's shape: Full counts history, Live where leads are now. */
const FULL = counts({
  New: [7358, '462351.00'],
  'Initial Contact': [673, '16990.00'],
  Warm: [318, '34674.00'],
  Hidden: [12, '500'],
  WON: [2775, '322171.00'],
  Converted: [2451, '282988.00'],
  LOST: [1076, '52523.00'],
});
const LIVE = counts({
  New: [1442, '219.00'],
  Warm: [248, '27309.05'],
  Hidden: [4, '99'],
  WON: [50, '900'],
  Converted: [2400, '280000'],
  LOST: [1027, '50000'],
});
const current = new Map([...LIVE].map(([name, row]) => [name, row.count]));

function report(overrides: Partial<SalesFunnelInput>) {
  return buildSalesFunnelReport({
    view: 'full',
    pipeline: 'Lead Pipeline',
    includeLost: true,
    stages: STAGES,
    counts: FULL,
    current,
    overall: 8359,
    ...overrides,
  });
}
const names = (rows: { stage: { name: string } }[]) =>
  rows.map((row) => row.stage.name);

describe('buildSalesFunnelReport — Full Funnel View', () => {
  it('tables every open sales stage, empty ones too', () => {
    const result = report({});
    expect(names(result.table)).toEqual(['New', 'Initial Contact', 'Warm']);
  });

  it('draws every sales stage in order, closed ones included, LOST while ticked', () => {
    expect(names(report({}).funnel)).toEqual([
      'New',
      'Initial Contact',
      'Warm',
      'WON',
      'Converted',
      'LOST',
      'ON HOLD SHIP',
    ]);
    expect(names(report({ includeLost: false }).funnel)).toEqual([
      'New',
      'Initial Contact',
      'Warm',
      'WON',
      'Converted',
      'ON HOLD SHIP',
    ]);
  });

  it('counts every lead in scope, and adds up the table’s value', () => {
    const { totals, table } = report({});
    expect(totals.leads).toBe(8359);
    // 462,351 + 16,990 + 34,674 — the capture's Total Value is its rows' sum the same way.
    expect(totals.totalValue).toBe('514015.00');
    expect(table.find((row) => row.stage.name === 'Warm')).toMatchObject({
      count: 318,
      totalValue: '34674.00',
      weightedValue: '17337.00',
    });
    expect(totals.weightedValue).toBe('17337.00');
  });

  it('shows an empty stage as zero rather than leaving it out', () => {
    const { table } = report({ counts: counts({}) });
    expect(table.map((row) => [row.count, row.totalValue])).toEqual([
      [0, '0.00'],
      [0, '0.00'],
      [0, '0.00'],
    ]);
  });
});

describe('buildSalesFunnelReport — Live Funnel View', () => {
  const live = (overrides: Partial<SalesFunnelInput> = {}) =>
    report({ view: 'live', counts: LIVE, ...overrides });

  it('tables the open stages that hold leads', () => {
    expect(names(live().table)).toEqual(['New', 'Warm']);
  });

  it('draws every stage holding leads, closed ones too, LOST while ticked', () => {
    expect(names(live().funnel)).toEqual([
      'New',
      'Warm',
      'WON',
      'Converted',
      'LOST',
    ]);
    expect(names(live({ includeLost: false }).funnel)).toEqual([
      'New',
      'Warm',
      'WON',
      'Converted',
    ]);
  });

  it('counts the open leads and rounds each weighted value half up', () => {
    const { totals, table } = live();
    expect(totals.leads).toBe(1690);
    expect(totals.totalValue).toBe('27528.05');
    // 27,309.05 × 50 % = 13,654.525 → 13,654.53.
    expect(table[1].weightedValue).toBe('13654.53');
    expect(totals.weightedValue).toBe('13654.53');
  });
});

describe('buildSalesFunnelReport — conversion', () => {
  it('is leads now in a WON stage over every lead in scope, whichever view', () => {
    // WON 50 + Converted 2,400, of 8,359.
    expect(report({}).conversionRate).toBeCloseTo((2450 / 8359) * 100, 10);
    expect(report({ view: 'live', counts: LIVE }).conversionRate).toBe(
      report({}).conversionRate,
    );
  });

  it('is null with no leads', () => {
    expect(report({ overall: 0 }).conversionRate).toBeNull();
  });
});
