/**
 * A minimal PDF 1.4 writer for report exports: A4 landscape pages of text, rules and boxes in the
 * standard Helvetica faces. Standard fonts need no embedding, so a file is a few kilobytes and no
 * PDF library is added — at the price of the Windows-1252 character set: anything outside it
 * prints as "?", which is why amounts carry "AED" rather than "د.إ".
 *
 * Callers place things in points from the page's top-left corner; the writer flips y.
 */

export const PAGE_WIDTH = 842;
export const PAGE_HEIGHT = 595;

export type PdfFont = 'regular' | 'bold';
export type Rgb = readonly [number, number, number];

export interface TextStyle {
  font?: PdfFont;
  size?: number;
  color?: Rgb;
  align?: 'left' | 'right';
}

/** Windows-1252's 0x80–0x9F, by code point. Every other byte is its Latin-1 code point. */
const WIN_ANSI_EXTRA = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

/** Each character as its Windows-1252 byte (one char per byte), "?" where it has none. */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    const byte =
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)
        ? code
        : (WIN_ANSI_EXTRA.get(code) ?? 0x3f);
    out += String.fromCharCode(byte);
  }
  return out;
}

/** Helvetica and Helvetica-Bold advance widths (1/1000 em) for 0x20–0x7E, from the Adobe AFMs. */
const WIDTHS: Record<PdfFont, readonly number[]> = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
    278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
    584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
    833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
    278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
    500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
    500, 334, 260, 334, 584,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
    278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
    584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
    833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
    278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
    556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
    500, 389, 280, 389, 584,
  ],
};

/** Wider glyphs beyond ASCII that a report prints; the rest measure as a digit. */
const EXTRA_WIDTHS = new Map<number, number>([
  [0xa0, 278],
  [0xb7, 278],
  [0x85, 1000],
  [0x96, 556],
  [0x97, 1000],
]);

/** A Windows-1252 string's width in points. */
function bytesWidth(bytes: string, font: PdfFont, size: number): number {
  let units = 0;
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes.charCodeAt(i);
    units +=
      code >= 0x20 && code <= 0x7e
        ? WIDTHS[font][code - 0x20]
        : (EXTRA_WIDTHS.get(code) ?? 556);
  }
  return (units * size) / 1000;
}

export function textWidth(text: string, font: PdfFont, size: number): number {
  return bytesWidth(toWinAnsi(text), font, size);
}

/** `text` cut with "…" to fit `width` points. */
export function fitText(
  text: string,
  width: number,
  font: PdfFont,
  size: number,
): string {
  if (textWidth(text, font, size) <= width) return text;
  const chars = [...text];
  while (
    chars.length > 0 &&
    textWidth(`${chars.join('')}…`, font, size) > width
  )
    chars.pop();
  return `${chars.join('')}…`;
}

const num = (value: number): string => String(Math.round(value * 100) / 100);
const rgb = ([r, g, b]: Rgb): string =>
  `${num(r / 255)} ${num(g / 255)} ${num(b / 255)}`;

export class PdfDocument {
  private readonly pages: string[][] = [];
  private ops: string[] = [];

  constructor() {
    this.addPage();
  }

  addPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
  }

  text(x: number, y: number, text: string, style: TextStyle = {}): void {
    const { font = 'regular', size = 10, color = [0, 0, 0] } = style;
    const bytes = toWinAnsi(text);
    const left =
      style.align === 'right' ? x - bytesWidth(bytes, font, size) : x;
    const escaped = bytes.replace(/[\\()]/g, (char) => `\\${char}`);
    this.ops.push(
      `BT /${font === 'bold' ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ` +
        `1 0 0 1 ${num(left)} ${num(PAGE_HEIGHT - y)} Tm (${escaped}) Tj ET`,
    );
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    paint: { fill?: Rgb; stroke?: Rgb },
  ): void {
    const box = `${num(x)} ${num(PAGE_HEIGHT - y - height)} ${num(width)} ${num(height)} re`;
    if (paint.fill && paint.stroke) {
      this.ops.push(
        `${rgb(paint.fill)} rg ${rgb(paint.stroke)} RG 0.75 w ${box} B`,
      );
    } else if (paint.fill) {
      this.ops.push(`${rgb(paint.fill)} rg ${box} f`);
    } else if (paint.stroke) {
      this.ops.push(`${rgb(paint.stroke)} RG 0.75 w ${box} S`);
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb): void {
    this.ops.push(
      `${rgb(color)} RG 0.5 w ${num(x1)} ${num(PAGE_HEIGHT - y1)} m ${num(x2)} ${num(PAGE_HEIGHT - y2)} l S`,
    );
  }

  /** The finished file: catalogue, page tree, the two fonts, then each page and its content. */
  toBuffer(): Buffer {
    const chunks: Buffer[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (data: string | Buffer) => {
      const buffer =
        typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
      chunks.push(buffer);
      length += buffer.length;
    };
    const object = (id: number, ...body: (string | Buffer)[]) => {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      body.forEach(push);
      push('\nendobj\n');
    };

    const pageIds = this.pages.map((_, index) => 5 + index * 2);
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(
      2,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    );
    object(
      3,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    object(
      4,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    this.pages.forEach((ops, index) => {
      const pageId = pageIds[index];
      object(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      );
      const stream = Buffer.from(ops.join('\n'), 'latin1');
      object(
        pageId + 1,
        `<< /Length ${stream.length} >>\nstream\n`,
        stream,
        '\nendstream',
      );
    });

    const size = offsets.length;
    const xref = length;
    push(
      `xref\n0 ${size}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
          .join(''),
    );
    push(
      `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    );
    return Buffer.concat(chunks);
  }
}
