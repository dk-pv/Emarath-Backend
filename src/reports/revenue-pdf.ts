import { PdfDocument } from './pdf-document';
import {
  aed,
  CONTENT,
  count,
  header,
  kpiCards,
  MARGIN,
  money,
  MUTED,
  percent,
  table,
} from './report-pdf-parts';
import type {
  RevenueGroup,
  RevenueOverviewResponse,
} from './dto/revenue-response.dto';
import { assignedLabel, type DealOrder } from './revenue-report';

/** The PDF lists at most this many deals; past it, the rest are counted, not printed. */
export const MAX_PDF_DEALS = 5_000;

const GROUP_NAMES: Record<RevenueGroup, string> = {
  none: '',
  pipeline: 'Pipeline',
  agent: 'Agent',
  role: 'Role',
  status: 'Status',
  source: 'Lead Source',
};

const orDash = (value: string | null): string =>
  value === null || value.trim() === '' ? '—' : value;

/** "+16.4% vs prior period"; the PDF's fonts have no arrows. */
const changeText = (value: number | null): string =>
  value === null
    ? 'No prior figure to compare'
    : `${value < 0 ? '-' : '+'}${percent(Math.abs(value))} vs prior period`;

const signed = (value: number | null): string =>
  value === null ? '—' : `${value < 0 ? '-' : '+'}${percent(Math.abs(value))}`;

function targetCaption(report: RevenueOverviewResponse): string {
  const { target } = report;
  // The card's figure is the share; its caption fits the target alone.
  if (target.period !== null) return `of ${aed(target.period)}`;
  return target.monthly === null
    ? 'No target set'
    : 'Targets are set per whole month';
}

/**
 * The Revenue Report as a PDF: the page's KPIs and target, the trend, both breakdowns, then the
 * Data Grid's deals in its order and grouping — the same result the page shows, from the same
 * query. Resolves the file and how many deals it lists, for the export audit.
 */
export function revenuePdf(
  report: RevenueOverviewResponse,
  order: DealOrder,
  meta: {
    subtitle: string;
    labels: readonly string[];
    group: RevenueGroup;
    generatedAt: Date;
  },
): { file: Buffer; listed: number } {
  const pdf = new PdfDocument();
  const { current, change, target } = report;
  let y = header(
    pdf,
    'Revenue Report',
    meta.subtitle,
    'Overview & Trend',
    meta.generatedAt,
  );

  y = kpiCards(pdf, y, [
    {
      label: 'Total Revenue',
      value: aed(current.revenue),
      caption: changeText(change.revenue),
      tone: 'blue',
    },
    {
      label: 'Deals Closed',
      value: count(current.deals),
      caption: changeText(change.deals),
      tone: 'green',
    },
    {
      label: 'Avg Deal Value',
      value: current.avgDealValue === null ? '—' : aed(current.avgDealValue),
      caption: changeText(change.avgDealValue),
      tone: 'purple',
    },
    {
      label: 'Conversion Rate',
      value:
        current.conversionRate === null ? '—' : percent(current.conversionRate),
      caption: changeText(change.conversionRate),
      tone: 'amber',
    },
    {
      label: 'Target achievement',
      value: target.percent === null ? '—' : `${Math.round(target.percent)}%`,
      caption: targetCaption(report),
      tone: 'green',
    },
  ]);

  y = table(
    pdf,
    y,
    'Revenue Trend',
    [
      { header: 'Period', width: 300, align: 'left' },
      { header: 'Revenue (AED)', width: 235, align: 'right' },
      { header: 'Deals', width: CONTENT - 535, align: 'right' },
    ],
    report.trend.map((bucket, index) => [
      meta.labels[index] ?? bucket.from.slice(0, 10),
      money(bucket.revenue),
      count(bucket.deals),
    ]),
  );
  if (target.monthly !== null) {
    pdf.text(
      MARGIN,
      y + 14,
      `Monthly target: ${aed(target.monthly)} (the members' monthly goals)`,
      { size: 9, color: MUTED },
    );
    y += 14;
  }

  y = table(
    pdf,
    y + 30,
    'Revenue By Lead Source',
    [
      { header: 'Source', width: 300, align: 'left' },
      { header: 'Revenue (AED)', width: 170, align: 'right' },
      { header: 'Conv. Rate', width: 150, align: 'right' },
      { header: 'Vs Prior', width: CONTENT - 620, align: 'right' },
    ],
    report.sources.map((row) => [
      row.source,
      money(row.revenue),
      row.conversionRate === null ? '—' : percent(row.conversionRate),
      signed(row.change),
    ]),
  );
  pdf.text(MARGIN, y + 14, "Attribution: each deal's current lead source", {
    size: 9,
    color: MUTED,
  });

  y = table(
    pdf,
    y + 44,
    'Revenue By Pipeline',
    [
      { header: 'Pipeline', width: 300, align: 'left' },
      { header: 'Revenue (AED)', width: 170, align: 'right' },
      { header: 'Deals', width: 100, align: 'right' },
      { header: 'Lost', width: 100, align: 'right' },
      { header: 'Win Rate', width: CONTENT - 670, align: 'right' },
    ],
    report.pipelines.map((row) => [
      row.pipeline,
      money(row.revenue),
      count(row.deals),
      count(row.lost),
      row.winRate === null ? '—' : percent(row.winRate),
    ]),
  );

  const total = order.entries.length;
  const listed = Math.min(total, MAX_PDF_DEALS);
  const rows: string[][] = [];
  let heading: string | null = null;
  order.entries.slice(0, listed).forEach(({ line, group }, index) => {
    if (group && group.key !== heading) {
      heading = group.key;
      rows.push([
        '',
        `${group.label} (${count(order.counts.get(group.key) ?? 0)})`,
      ]);
    }
    rows.push([
      count(index + 1),
      line.name,
      line.pipeline,
      orDash(assignedLabel(line)),
      line.status,
      line.actualAmount === null ? '—' : money(line.actualAmount.toString()),
      orDash(line.secondaryPhone),
      orDash(line.product),
      orDash(line.language),
      orDash(line.country),
    ]);
  });
  const title = [
    `Deals (${count(total)})`,
    meta.group === 'none' ? null : `grouped by ${GROUP_NAMES[meta.group]}`,
    listed < total ? `first ${count(listed)} listed` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  table(
    pdf,
    y + 30,
    title,
    [
      // Each header fits its column in 9pt Helvetica-Bold, so none is cut.
      { header: '#', width: 26, align: 'right' },
      { header: 'Customer Name', width: 104, align: 'left' },
      { header: 'Pipeline', width: 72, align: 'left' },
      { header: 'Assigned', width: 96, align: 'left' },
      { header: 'Status', width: 50, align: 'left' },
      { header: 'Amount (AED)', width: 90, align: 'right' },
      { header: 'Secondary Phone', width: 94, align: 'left' },
      { header: 'Product', width: 96, align: 'left' },
      { header: 'Language', width: 60, align: 'left' },
      { header: 'Country', width: CONTENT - 688, align: 'left' },
    ],
    rows,
  );

  return { file: pdf.toBuffer(), listed };
}
