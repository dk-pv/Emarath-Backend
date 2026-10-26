import { salesFunnelPdf } from './sales-funnel-pdf';
import type {
  SalesFunnelResponse,
  SalesFunnelStageRow,
} from './dto/sales-funnel-response.dto';

const row = (
  name: string,
  count: number,
  totalValue: string,
  probability = 0,
): SalesFunnelStageRow => ({
  stage: {
    id: name,
    name,
    color: 'violet',
    probability,
    isClosed: false,
    outcome: null,
  },
  count,
  totalValue,
  weightedValue: ((Number(totalValue) * probability) / 100).toFixed(2),
});

function report(overrides: Partial<SalesFunnelResponse> = {}) {
  const table = [row('New', 1442, '219.00'), row('Warm', 248, '27309.00', 50)];
  return {
    view: 'live',
    pipeline: 'Lead Pipeline',
    funnel: table,
    table,
    totals: { leads: 1690, totalValue: '27528.00', weightedValue: '13654.50' },
    conversionRate: 31.29,
    ...overrides,
  } satisfies SalesFunnelResponse;
}

const pdf = (
  value: SalesFunnelResponse,
  meta: Partial<Parameters<typeof salesFunnelPdf>[1]> = {},
) =>
  salesFunnelPdf(value, {
    subtitle: 'Last 30 Days · All agents · Lead Pipeline',
    includeLost: true,
    generatedAt: new Date('2026-10-26T10:15:00Z'),
    ...meta,
  }).toString('latin1');

describe('salesFunnelPdf', () => {
  it('carries the header line, the four KPI cards and both tables', () => {
    const text = pdf(report());
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('(Sales Funnel Report) Tj');
    expect(text).toContain('(Generated 2026-10-26 10:15 UTC) Tj');
    expect(text).toContain(
      '(Last 30 Days \xb7 All agents \xb7 Lead Pipeline) Tj',
    );
    expect(text).toContain('(Live Funnel View: Current stage of each lead) Tj');
    expect(text).toContain('(1,690) Tj');
    expect(text).toContain('(27,528.00 AED) Tj');
    expect(text).toContain('(31.3%) Tj');
    expect(text).toContain('(13,654.50 AED) Tj');
    expect(text).toContain('(Funnel Movement) Tj');
    expect(text).toContain('(Stage Metrics) Tj');
    // The Warm step: 248 of 1,442.
    expect(text).toContain('(17.2%) Tj');
    expect(text).toContain('(50%) Tj');
  });

  it('adds a Total row to Live only — Full counts a lead in every stage it passed', () => {
    expect(pdf(report())).toContain('(Total) Tj');
    expect(pdf(report({ view: 'full' }))).not.toContain('(Total) Tj');
    expect(pdf(report({ view: 'full' }))).toContain(
      '(Full Funnel View: Leads progression across all stages) Tj',
    );
  });

  it('says when the lost stage is left out, and when nothing matched', () => {
    const text = pdf(report({ funnel: [], table: [] }), { includeLost: false });
    // Inside a PDF string the brackets are escaped.
    expect(text).toContain('\\(lost stage excluded\\)');
    expect(text).toContain('(No result with current filter) Tj');
  });

  it('flows a long table onto further pages', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      row(`Stage ${index + 1}`, index, '1.00'),
    );
    const text = pdf(report({ funnel: many, table: many }));
    expect(text).toMatch(/\/Count [3-9]/);
    expect(text).toContain('(Stage 40) Tj');
  });
});
