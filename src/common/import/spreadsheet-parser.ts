import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * A parsed spreadsheet: the header row and the data rows beneath it (LEAD-07.1 AC1).
 *
 * Every cell is a string — the engine validates and coerces from there, so a number
 * or date the file happens to store keeps the exact text the user saw rather than a
 * locale-formatted round-trip.
 */
export interface ParsedSheet {
  headers: string[];
  /** One array per data row, aligned to `headers`; fully-empty rows are dropped. */
  rows: string[][];
}

/** The 10 MB business cap (matches the upload UI); files are read fully in memory. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const XLSX = /\.xlsx$/i;
const CSV = /\.csv$/i;

/**
 * Parses a CSV or XLSX upload into headers + rows using a single library (ExcelJS
 * reads both), so the engine never learns which format it was handed.
 *
 * The first row is the header. Empty rows are dropped so a trailing blank line does
 * not become a `ROW_EMPTY` failure. Reading is a full in-memory load, which the
 * 10 MB cap keeps bounded — streaming is an optimisation a 10 MB ceiling does not
 * need.
 */
export async function parseSpreadsheet(file: {
  originalname: string;
  buffer: Buffer;
  size: number;
}): Promise<ParsedSheet> {
  if (!file.buffer || file.size === 0) {
    throw new BadRequestException('The uploaded file is empty.');
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new BadRequestException('The file exceeds the 10MB limit.');
  }

  const worksheet = await readWorksheet(file);
  if (!worksheet || worksheet.rowCount === 0) {
    throw new BadRequestException('The file has no rows.');
  }

  const columnCount = worksheet.actualColumnCount || worksheet.columnCount;
  if (columnCount === 0) {
    throw new BadRequestException('The file has no columns.');
  }

  const headers = readRow(worksheet.getRow(1), columnCount).map(
    (value, index) => (value === '' ? `Column ${index + 1}` : value),
  );

  const rows: string[][] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const cells = readRow(worksheet.getRow(rowNumber), columnCount);
    if (cells.some((cell) => cell !== '')) rows.push(cells);
  }

  return { headers, rows };
}

async function readWorksheet(file: {
  originalname: string;
  buffer: Buffer;
}): Promise<ExcelJS.Worksheet | undefined> {
  const workbook = new ExcelJS.Workbook();

  try {
    if (XLSX.test(file.originalname)) {
      // Read from a stream rather than `load(buffer)` — it avoids the @types/node
      // Buffer-generic mismatch with ExcelJS's `Buffer` param and mirrors the CSV path.
      await workbook.xlsx.read(Readable.from(file.buffer));
      return workbook.worksheets[0];
    }
    if (CSV.test(file.originalname)) {
      // ExcelJS reads CSV from a stream into a worksheet; any number/date it infers
      // is flattened back to text by cellToString, so ids and phones stay intact.
      return await workbook.csv.read(Readable.from(file.buffer));
    }
  } catch {
    throw new BadRequestException('The file could not be read.');
  }

  throw new BadRequestException('File must be a CSV or XLSX.');
}

function readRow(row: ExcelJS.Row, columnCount: number): string[] {
  const cells: string[] = [];
  for (let column = 1; column <= columnCount; column += 1) {
    cells.push(cellToString(row.getCell(column).value));
  }
  return cells;
}

/** Flattens every ExcelJS cell shape (rich text, formula, hyperlink, date) to text. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text.trim();
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    if ('result' in value) return cellToString(value.result ?? '');
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return value.hyperlink.trim();
    }
  }

  return '';
}
