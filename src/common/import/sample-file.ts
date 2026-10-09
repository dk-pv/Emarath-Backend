import ExcelJS from 'exceljs';
import { escapeCsv } from './errors-to-csv';
import { ImportField } from './import-descriptor';

export type SampleFormat = 'csv' | 'xlsx';

/**
 * The downloadable import template: one column per importable field, headed by the
 * field's label — the exact text the Map Fields step auto-maps — then the example
 * rows. Built from the same field catalog the importer validates against, so the
 * template maps and validates as written. Filled in with Excel, the XLSX keeps its
 * formats; a CSV saved by Excel loses them (see `csvValue`), which the importer reports.
 *
 * CSV carries a UTF-8 BOM so Excel opens Arabic names correctly (the parser strips it).
 * In XLSX the phone columns are Text-formatted, so Excel keeps a number's leading zero
 * and "+" as typed; amounts are real numbers and dates real dates, which the parser
 * reads back as plain text and YYYY-MM-DD.
 */
export async function buildSampleFile(
  fields: readonly ImportField[],
  rows: Record<string, string>[],
  format: SampleFormat,
): Promise<Buffer> {
  if (format === 'csv') {
    const lines = [
      fields.map((field) => field.label),
      ...rows.map((row) => fields.map((field) => csvValue(field, row))),
    ].map((cells) => cells.map(escapeCsv).join(','));
    return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Leads');
  sheet.columns = fields.map((field) => ({
    width: Math.max(14, field.label.length + 4),
    style:
      field.type === 'phone'
        ? { numFmt: '@' }
        : field.type === 'date'
          ? { numFmt: 'yyyy-mm-dd' }
          : {},
  }));
  sheet.addRow(fields.map((field) => field.label)).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(fields.map((field) => xlsxValue(field, row[field.value])));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Excel opens a CSV in place and saves it back as displayed: a 12-digit phone comes back
 * as 9.71501E+11 and a date in the local short-date format. So a phone carries a space
 * after its country code (Excel keeps it as text; the importer strips it) and the
 * example date is left blank — the XLSX sample keeps both as typed.
 */
function csvValue(field: ImportField, row: Record<string, string>): string {
  const value = row[field.value] ?? '';
  if (value === '' || field.type === 'date') return '';
  if (field.type === 'phone') return `${value.slice(0, 3)} ${value.slice(3)}`;
  return value;
}

function xlsxValue(field: ImportField, value = ''): ExcelJS.CellValue {
  if (value === '') return null;
  if (field.type === 'decimal' || field.type === 'int') return Number(value);
  if (field.type === 'date') return new Date(`${value}T00:00:00.000Z`);
  return value;
}
