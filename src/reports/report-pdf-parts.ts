import {
  fitText,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PdfDocument,
  type Rgb,
} from './pdf-document';

/** The pieces the Analytics report PDFs share: header, KPI cards, flowing tables, formats. */

export const MARGIN = 36;
export const CONTENT = PAGE_WIDTH - MARGIN * 2;
const ROW = 18;

export const INK: Rgb = [33, 33, 33];
export const MUTED: Rgb = [110, 110, 110];
const RULE: Rgb = [226, 226, 226];
const HEAD_FILL: Rgb = [245, 246, 248];

/** The report cards' accents, over a light tint of each. */
export const TONES = {
  blue: { stroke: [48, 96, 255], fill: [234, 239, 255] },
  green: { stroke: [28, 210, 109], fill: [228, 249, 237] },
  amber: { stroke: [245, 158, 11], fill: [254, 243, 222] },
  red: { stroke: [239, 68, 68], fill: [254, 236, 236] },
  purple: { stroke: [173, 101, 202], fill: [246, 236, 250] },
} as const satisfies Record<string, { stroke: Rgb; fill: Rgb }>;

const COUNT = new Intl.NumberFormat('en-US');
const MONEY = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const count = (value: number): string => COUNT.format(value);
export const money = (value: string): string => MONEY.format(Number(value));
export const aed = (value: string): string => `${money(value)} AED`;
export const percent = (value: number): string =>
  `${Number(value.toFixed(1))}%`;

export interface Column {
  header: string;
  width: number;
  align: 'left' | 'right';
}

export interface KpiCard {
  label: string;
  value: string;
  caption: string;
  tone: keyof typeof TONES;
}

/** Title, generated stamp, the filters line and the view line. Returns the y below them. */
export function header(
  pdf: PdfDocument,
  title: string,
  subtitle: string,
  line: string,
  generatedAt: Date,
): number {
  let y = MARGIN;
  pdf.text(MARGIN, y + 16, title, { font: 'bold', size: 18, color: INK });
  pdf.text(
    PAGE_WIDTH - MARGIN,
    y + 16,
    `Generated ${utcStamp(generatedAt)} UTC`,
    {
      size: 9,
      color: MUTED,
      align: 'right',
    },
  );
  y += 32;
  pdf.text(MARGIN, y, subtitle, { size: 10, color: MUTED });
  y += 18;
  pdf.text(MARGIN, y, line, { font: 'bold', size: 11, color: INK });
  return y + 12;
}

/** One row of KPI cards across the page. Returns the y below them. */
export function kpiCards(
  pdf: PdfDocument,
  top: number,
  cards: readonly KpiCard[],
): number {
  const gap = 12;
  const width = (CONTENT - gap * (cards.length - 1)) / cards.length;
  cards.forEach(({ label, value, caption, tone }, index) => {
    const x = MARGIN + index * (width + gap);
    pdf.rect(x, top, width, 60, TONES[tone]);
    pdf.text(x + 10, top + 16, label, { size: 9, color: INK });
    pdf.text(x + 10, top + 37, fitText(value, width - 20, 'bold', 15), {
      font: 'bold',
      size: 15,
      color: INK,
    });
    pdf.text(x + 10, top + 52, fitText(caption, width - 20, 'regular', 8), {
      size: 8,
      color: MUTED,
    });
  });
  return top + 60 + 26;
}

/**
 * A titled table that flows onto new pages, repeating its header row. Returns the y below it.
 */
export function table(
  pdf: PdfDocument,
  top: number,
  title: string,
  columns: readonly Column[],
  rows: readonly string[][],
  total?: readonly string[],
): number {
  let y = top;
  const fits = (height: number) => y + height <= PAGE_HEIGHT - MARGIN;
  if (!fits(ROW * 3)) {
    pdf.addPage();
    y = MARGIN;
  }
  pdf.text(MARGIN, y, title, { font: 'bold', size: 12, color: INK });
  y += 8;

  const cells = (values: readonly string[], font: 'regular' | 'bold') => {
    let x = MARGIN;
    columns.forEach((column, index) => {
      const value = fitText(values[index] ?? '', column.width - 16, font, 9);
      pdf.text(
        column.align === 'right' ? x + column.width - 8 : x + 8,
        y + 12.5,
        value,
        {
          font,
          size: 9,
          color: INK,
          align: column.align,
        },
      );
      x += column.width;
    });
  };
  const head = () => {
    pdf.rect(MARGIN, y, CONTENT, ROW, { fill: HEAD_FILL });
    cells(
      columns.map((column) => column.header),
      'bold',
    );
    y += ROW;
  };

  head();
  if (rows.length === 0) {
    pdf.text(MARGIN + 8, y + 12.5, 'No result with current filter', {
      size: 9,
      color: MUTED,
    });
    y += ROW;
  }
  for (const values of rows) {
    if (!fits(ROW)) {
      pdf.addPage();
      y = MARGIN;
      head();
    }
    cells(values, 'regular');
    y += ROW;
    pdf.line(MARGIN, y, MARGIN + CONTENT, y, RULE);
  }
  if (total) {
    if (!fits(ROW)) {
      pdf.addPage();
      y = MARGIN;
      head();
    }
    cells(total, 'bold');
    y += ROW;
  }
  return y;
}

/** `2026-10-26 15:40` — the server knows no viewer's timezone, so the stamp says UTC. */
function utcStamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/** `YYYYMMDD-HHmmss` (UTC), the other exports' file-name stamp. */
export function fileStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}
