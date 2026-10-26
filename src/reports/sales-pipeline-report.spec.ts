import { Prisma } from '../generated/prisma/client';
import type { StageProgression } from './sales-funnel-progression';
import type { FunnelStage } from './sales-funnel-report';
import {
  buildSalesPipelineReport,
  coverageStatus,
  pipelineCoverage,
  type SalesPipelineInput,
} from './sales-pipeline-report';

const dec = (value: string) => new Prisma.Decimal(value);
let next = 0;
const stage = (
  name: string,
  extra: Partial<FunnelStage> = {},
): FunnelStage => ({
  id: `s-${++next}`,
  name,
  color: 'violet',
  isClosed: false,
  outcome: null,
  inclusion: 'INCLUDE_IN_SALES_PIPELINE',
  probability: 0,
  ...extra,
});
const STAGES = [
  stage('New'),
  stage('Warm', { probability: 50 }),
  stage('Follow-up', { probability: 25 }),
  stage('Hidden', { inclusion: 'EXCLUDE_FROM_SALES_PIPELINE' }),
  stage('WON', { isClosed: true, outcome: 'WON' }),
  stage('LOST', { isClosed: true, outcome: 'LOST' }),
];
const current = (rows: Record<string, [number, string]>) =>
  new Map<string, StageProgression>(
    Object.entries(rows).map(([name, [count, value]]) => [
      name,
      { count, value: dec(value) },
    ]),
  );

function report(overrides: Partial<SalesPipelineInput> = {}) {
  return buildSalesPipelineReport({
    pipeline: 'Lead Pipeline',
    stages: STAGES,
    current: current({
      New: [10, '1000'],
      Warm: [4, '2000.05'],
      Hidden: [3, '900'],
      WON: [7, '5000'],
      LOST: [2, '100'],
    }),
    won: 5,
    revenue: { achieved: dec('308655'), target: dec('5640') },
    ...overrides,
  });
}

describe('buildSalesPipelineReport — the open pipeline', () => {
  it('lists every open sales stage, empty ones too, never closed or excluded ones', () => {
    expect(report().stages.map((row) => [row.stage.name, row.count])).toEqual([
      ['New', 10],
      ['Warm', 4],
      ['Follow-up', 0],
    ]);
  });

  it('adds up the open leads, their value and the probability-weighted value', () => {
    // 2,000.05 × 50 % = 1,000.025 → 1,000.03 (half up, to the fils).
    expect(report().totals).toEqual({
      leads: 14,
      totalValue: '3000.05',
      weightedValue: '1000.03',
    });
  });

  it('reads zero across the board with no open leads', () => {
    const empty = report({ current: current({}) });
    expect(empty.totals).toEqual({
      leads: 0,
      totalValue: '0.00',
      weightedValue: '0.00',
    });
    expect(empty.coverage).toEqual({ ratio: 0, status: 'critical' });
  });

  it('passes the Won count through', () => {
    expect(report().won).toBe(5);
  });
});

describe('buildSalesPipelineReport — this month', () => {
  it('reports achieved against target, uncapped (the capture beats its target 54×)', () => {
    expect(report().revenue).toEqual({
      achieved: '308655.00',
      target: '5640.00',
      percent: 5472.61,
    });
  });

  it('has no percentage and no coverage without a target', () => {
    for (const target of [null, dec('0')]) {
      const result = report({ revenue: { achieved: dec('10'), target } });
      expect(result.revenue).toEqual({
        achieved: '10.00',
        target: null,
        percent: null,
      });
      expect(result.coverage).toEqual({ ratio: null, status: null });
    }
  });

  it('measures coverage as open value over the target', () => {
    // 3,000.05 ÷ 1,000 = 3.00005 → 3.0001, on track.
    expect(
      report({ revenue: { achieved: dec('0'), target: dec('1000') } }).coverage,
    ).toEqual({ ratio: 3.0001, status: 'on-track' });
  });
});

describe('pipelineCoverage and its zones', () => {
  it('splits at 1.5× and 3×', () => {
    expect(coverageStatus(0)).toBe('critical');
    expect(coverageStatus(1.4999)).toBe('critical');
    expect(coverageStatus(1.5)).toBe('risk');
    expect(coverageStatus(2.9999)).toBe('risk');
    expect(coverageStatus(3)).toBe('on-track');
    expect(coverageStatus(1e6)).toBe('on-track');
  });

  it('is undefined, not zero, without a positive target', () => {
    expect(pipelineCoverage(dec('500'), null)).toEqual({
      ratio: null,
      status: null,
    });
    expect(pipelineCoverage(dec('500'), dec('-1'))).toEqual({
      ratio: null,
      status: null,
    });
  });

  it('keeps a valid target with no pipeline at 0×, Critical', () => {
    expect(pipelineCoverage(dec('0'), dec('5640'))).toEqual({
      ratio: 0,
      status: 'critical',
    });
  });
});
