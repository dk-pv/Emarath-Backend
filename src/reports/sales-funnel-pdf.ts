import { PdfDocument } from './pdf-document';
import {
  aed,
  CONTENT,
  count,
  header,
  kpiCards,
  money,
  percent,
  table,
} from './report-pdf-parts';
import type {
  SalesFunnelResponse,
  SalesFunnelView,
} from './dto/sales-funnel-response.dto';

const VIEW_TITLE: Record<SalesFunnelView, string> = {
  full: 'Full Funnel View',
  live: 'Live Funnel View',
};
const VIEW_HEADING: Record<SalesFunnelView, string> = {
  full: 'Leads progression across all stages',
  live: 'Current stage of each lead',
};

/**
 * The Sales Funnel Report as a PDF: its header line, the four KPI cards, then the Funnel
 * Movement steps and the Stage Metrics table — the figures the page shows, from the same
 * `buildSalesFunnelReport` result, so the file and the screen can never disagree.
 */
export function salesFunnelPdf(
  report: SalesFunnelResponse,
  meta: { subtitle: string; includeLost: boolean; generatedAt: Date },
): Buffer {
  const pdf = new PdfDocument();
  let y = header(
    pdf,
    'Sales Funnel Report',
    meta.subtitle,
    `${VIEW_TITLE[report.view]}: ${VIEW_HEADING[report.view]}` +
      (meta.includeLost ? '' : ' (lost stage excluded)'),
    meta.generatedAt,
  );

  y = kpiCards(pdf, y, [
    {
      label: 'Total Leads',
      value: count(report.totals.leads),
      caption: 'Active leads in the pipeline',
      tone: 'blue',
    },
    {
      label: 'Total Value',
      value: aed(report.totals.totalValue),
      caption: 'Cumulative leads potential',
      tone: 'blue',
    },
    {
      label: 'Conversion Rate',
      value:
        report.conversionRate === null ? '—' : percent(report.conversionRate),
      caption: 'Conversion efficiency',
      tone: 'green',
    },
    {
      label: 'Weighted Forecast',
      value: aed(report.totals.weightedValue),
      caption: 'Probability adjusted pipeline',
      tone: 'amber',
    },
  ]);

  y = table(
    pdf,
    y,
    'Funnel Movement',
    [
      { header: 'Stage', width: 370, align: 'left' },
      { header: 'Leads', width: 120, align: 'right' },
      { header: 'Value (AED)', width: 160, align: 'right' },
      { header: 'From previous stage', width: CONTENT - 650, align: 'right' },
    ],
    report.funnel.map((row, index) => {
      const previous = report.funnel[index - 1]?.count;
      const step =
        previous === undefined || previous === 0
          ? '—'
          : percent((row.count / previous) * 100);
      return [row.stage.name, count(row.count), money(row.totalValue), step];
    }),
  );

  table(
    pdf,
    y + 22,
    'Stage Metrics',
    [
      { header: 'Stage Name', width: 300, align: 'left' },
      { header: 'Probability %', width: 110, align: 'right' },
      { header: 'Lead Count', width: 110, align: 'right' },
      { header: 'Total Value (AED)', width: 125, align: 'right' },
      { header: 'Weighted Value (AED)', width: CONTENT - 645, align: 'right' },
    ],
    report.table.map((row) => [
      row.stage.name,
      `${row.stage.probability}%`,
      count(row.count),
      money(row.totalValue),
      money(row.weightedValue),
    ]),
    // Live's rows are one lead each and add up; Full counts a lead in every stage it passed.
    report.view === 'live'
      ? [
          'Total',
          '--',
          count(report.totals.leads),
          money(report.totals.totalValue),
          money(report.totals.weightedValue),
        ]
      : undefined,
  );

  return pdf.toBuffer();
}
