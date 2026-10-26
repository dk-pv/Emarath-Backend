import { fitText, PdfDocument, textWidth, toWinAnsi } from './pdf-document';

/** Every xref entry must point at its own `N 0 obj`, and startxref at the table. */
function assertWellFormed(file: Buffer): void {
  const text = file.toString('latin1');
  expect(text.startsWith('%PDF-1.4\n')).toBe(true);
  expect(text.endsWith('%%EOF\n')).toBe(true);

  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');

  const [, size] = /xref\n0 (\d+)\n/.exec(text.slice(startxref)) ?? [];
  const entries = text
    .slice(startxref)
    .split('\n')
    .filter((line) => / 00000 n $/.test(line));
  expect(entries).toHaveLength(Number(size) - 1);
  entries.forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(
      `${index + 1} 0 obj`,
    );
  });
  // Each stream's declared length is its byte length.
  for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    expect(
      text.slice(start + Number(match[1]), start + Number(match[1]) + 10),
    ).toBe('\nendstream');
  }
}

describe('toWinAnsi', () => {
  it('keeps ASCII and Latin-1, maps Windows-1252’s extras, and marks the rest', () => {
    expect(toWinAnsi('Lead · Pipeline')).toBe('Lead \xb7 Pipeline');
    expect(toWinAnsi('A – B…')).toBe('A \x96 B\x85');
    expect(toWinAnsi('د.إ')).toBe('?.?');
    expect(toWinAnsi('tab\there')).toBe('tab?here');
  });
});

describe('text measuring', () => {
  it('uses Helvetica’s advance widths', () => {
    expect(textWidth('0123456789', 'regular', 10)).toBeCloseTo(55.6, 5);
    expect(textWidth('Total', 'bold', 10)).toBeCloseTo(23.89, 5);
  });

  it('cuts text with an ellipsis to fit', () => {
    expect(fitText('Short', 100, 'regular', 9)).toBe('Short');
    const cut = fitText('DATE SHIPMENT-WAITING FOR STOCK', 80, 'regular', 9);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 'regular', 9)).toBeLessThanOrEqual(80);
  });
});

describe('PdfDocument', () => {
  it('writes a well-formed file whose cross-reference table matches its objects', () => {
    const pdf = new PdfDocument();
    pdf.text(36, 50, 'Sales Funnel (Live)', { font: 'bold', size: 18 });
    pdf.rect(36, 60, 100, 40, { fill: [234, 239, 255], stroke: [48, 96, 255] });
    pdf.line(36, 120, 806, 120, [226, 226, 226]);
    pdf.addPage();
    pdf.text(806, 50, 'Right \\ aligned', { align: 'right' });

    const file = pdf.toBuffer();
    assertWellFormed(file);
    const text = file.toString('latin1');
    expect(text).toContain('/Count 2');
    // Parentheses and backslashes are escaped inside the string operand.
    expect(text).toContain('(Sales Funnel \\(Live\\)) Tj');
    expect(text).toContain('(Right \\\\ aligned) Tj');
    expect(text).toContain('/BaseFont /Helvetica-Bold');
  });
});
