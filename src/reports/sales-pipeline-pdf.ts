import { PdfDocument } from './pdf-document';
import {
  aed,
  CONTENT,
  count,
  header,
  INK,
  kpiCards,
  MARGIN,
  money,
  MUTED,
  table,
} from './report-pdf-parts';
import type {
  CoverageStatus,
  SalesPipelineResponse,
  SalesPipelineView,
} from './dto/sales-pipeline-response.dto';

const VIEW_LINE: Record<SalesPipelineView, string> = {
  health:
    'Pipeline Health: Pipeline strength and forecast coverage at a glance',
  closing:
    'Closing Leads: All leads due to close, with their value and stage details',
};
const STATUS: Record<CoverageStatus, string> = {
  critical: 'Critical',
  risk: 'Risk',
  'on-track': 'On track',
};
const NO_CLOSE_DATE = 'Needs expected closing dates';

/** `2.5×`; a dash without a target. */
export const coverageText = (ratio: number | null): string =>
  ratio === null ? '—' : `${ratio.toFixed(2)}×`;

/**
 * Sales Pipeline Analysis as a PDF: its header line, the five KPI cards, this month's revenue
 * against target and the coverage, then Stage Metrics — the page's own figures, from the same
 * `buildSalesPipelineReport` result. The closing figures say what they need, as on the page.
 */
export function salesPipelinePdf(
  report: SalesPipelineResponse,
  meta: { subtitle: string; view: SalesPipelineView; generatedAt: Date },
): Buffer {
  const pdf = new PdfDocument();
  let y = header(
    pdf,
    'Sales Pipeline Analysis',
    meta.subtitle,
    VIEW_LINE[meta.view],
    meta.generatedAt,
  );
  const { coverage, revenue } = report;

  y = kpiCards(pdf, y, [
    {
      label: 'Total Open Leads',
      value: `${aed(report.totals.totalValue)} · ${count(report.totals.leads)}`,
      caption: 'Pipeline Value · Lead Count',
      tone: 'blue',
    },
    {
      label: 'Weighted Forecast',
      value: aed(report.totals.weightedValue),
      caption: 'Probability-adjusted value',
      tone: 'amber',
    },
    {
      label: 'Coverage Ratio (This Month)',
      value: coverageText(coverage.ratio),
      caption: coverage.status ? STATUS[coverage.status] : 'No target set',
      tone: 'red',
    },
    {
      label: 'Closing This Month',
      value: '—',
      caption: NO_CLOSE_DATE,
      tone: 'purple',
    },
    {
      label: 'Won',
      value: count(report.won),
      caption: 'Won leads in selected period',
      tone: 'green',
    },
  ]);

  pdf.text(MARGIN, y, 'This month', { font: 'bold', size: 12, color: INK });
  pdf.text(
    MARGIN,
    y + 18,
    `Revenue achieved ${aed(revenue.achieved)} of ${
      revenue.target === null ? 'no target set' : aed(revenue.target)
    }${revenue.percent === null ? '' : ` · ${revenue.percent}% achieved`}`,
    { size: 10, color: INK },
  );
  pdf.text(
    MARGIN,
    y + 34,
    `Pipeline coverage (3× rule) ${coverageText(coverage.ratio)}${
      coverage.status ? ` · ${STATUS[coverage.status]}` : ''
    } — open pipeline value ÷ this month's target`,
    { size: 10, color: INK },
  );
  if (meta.view === 'closing') {
    pdf.text(
      MARGIN,
      y + 50,
      'Closing Value by Owner and Leads Closing need an expected closing date, which Emarath does not record on a lead.',
      { size: 9, color: MUTED },
    );
  }
  y += meta.view === 'closing' ? 76 : 60;

  table(
    pdf,
    y,
    'Stage Metrics',
    [
      { header: 'Stage Name', width: 300, align: 'left' },
      { header: 'Probability %', width: 110, align: 'right' },
      { header: 'Lead Count', width: 110, align: 'right' },
      { header: 'Total Value (AED)', width: 125, align: 'right' },
      { header: 'Weighted Value (AED)', width: CONTENT - 645, align: 'right' },
    ],
    report.stages.map((row) => [
      row.stage.name,
      `${row.stage.probability}%`,
      count(row.count),
      money(row.totalValue),
      money(row.weightedValue),
    ]),
    [
      'Total',
      '--',
      count(report.totals.leads),
      money(report.totals.totalValue),
      money(report.totals.weightedValue),
    ],
  );

  return pdf.toBuffer();
}
