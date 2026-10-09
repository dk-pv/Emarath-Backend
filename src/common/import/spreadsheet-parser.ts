import { isUtf8 } from 'node:buffer';
import { Readable } from 'node:stream';
import { BadRequestException, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';

/** One data row: its row number in the file (as Excel shows it) and its cells. */
export interface ParsedRow {
  rowNumber: number;
  /** Aligned to `ParsedSheet.headers`. */
  cells: string[];
}

/**
 * A parsed spreadsheet: the header row and the data rows beneath it (LEAD-07.1 AC1).
 *
 * Every cell is a string — the engine validates and coerces from there, so a number
 * or date the file happens to store keeps the exact text the user saw rather than a
 * locale-formatted round-trip.
 */
export interface ParsedSheet {
  headers: string[];
  /** Fully-empty rows are dropped; each kept row carries its real row number. */
  rows: ParsedRow[];
}

/** The 10 MB business cap (matches the upload UI); files are read fully in memory. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const XLSX = /\.xlsx$/i;
const CSV = /\.csv$/i;

const logger = new Logger('SpreadsheetParser');

/**
 * Parses a CSV or XLSX upload into headers + rows using a single library (ExcelJS
 * reads both), so the engine never learns which format it was handed.
 *
 * The first non-empty row is the header. Empty rows are dropped so a trailing blank
 * line does not become a `ROW_EMPTY` failure, but every kept row keeps its own row
 * number, so a reported error points at the line the user sees. Reading is a full
 * in-memory load, which the 10 MB cap keeps bounded.
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
  const lines: ParsedRow[] = [];
  let columnCount = 0;
  // The rightmost non-empty cell, not `actualColumnCount` — that counts used columns,
  // so one empty column in the middle would silently cut off the last one.
  worksheet?.eachRow((row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = cellToString(cell.value);
      if (cells[column - 1] !== '') columnCount = Math.max(columnCount, column);
    });
    if (cells.some((cell) => cell !== '')) lines.push({ rowNumber, cells });
  });

  const [headerLine, ...dataLines] = lines;
  if (!headerLine) {
    throw new BadRequestException('The file has no rows.');
  }

  const headers = pad(headerLine.cells, columnCount).map((value, index) =>
    value === '' ? `Column ${index + 1}` : value,
  );
  // Excel under a regional format whose list separator is ";" (Arabic UAE among
  // them) saves "CSV" that way; read with commas it is one merged column.
  if (
    CSV.test(file.originalname) &&
    headers.length === 1 &&
    headers[0].includes(';')
  ) {
    throw new BadRequestException(
      'This CSV is separated by semicolons. Save it as "CSV UTF-8 (Comma delimited)" or as XLSX and upload it again.',
    );
  }
  const repeated = headers.find((header, index) =>
    headers.slice(0, index).includes(header),
  );
  if (repeated) {
    // The row is named: a title row above the real header is the usual cause.
    throw new BadRequestException(
      `The column "${repeated}" appears more than once in the header row (row ${headerLine.rowNumber}). Rename or remove the extra column and upload the file again.`,
    );
  }

  if (dataLines.length === 0) {
    throw new BadRequestException('The file has no data rows to import.');
  }

  return {
    headers,
    rows: dataLines.map((line) => ({
      rowNumber: line.rowNumber,
      cells: pad(line.cells, columnCount),
    })),
  };
}

async function readWorksheet(file: {
  originalname: string;
  buffer: Buffer;
}): Promise<ExcelJS.Worksheet | undefined> {
  const isXlsx = XLSX.test(file.originalname);
  const isCsv = CSV.test(file.originalname);
  if (!isXlsx && !isCsv) {
    throw new BadRequestException('File must be a CSV or XLSX.');
  }
  // A zip, a UTF-16 or an ANSI-encoded file would otherwise "parse" into garbage rows.
  if (isCsv && (!isUtf8(file.buffer) || file.buffer.includes(0))) {
    throw new BadRequestException(
      'The CSV could not be read as text. Save it as "CSV UTF-8 (Comma delimited)" or as XLSX and upload it again.',
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    if (isXlsx) {
      // Read from a stream rather than `load(buffer)` — it avoids the @types/node
      // Buffer-generic mismatch with ExcelJS's `Buffer` param and mirrors the CSV path.
      await workbook.xlsx.read(Readable.from(file.buffer));
      // The first sheet a user can see that has data — not an empty or hidden one.
      return (
        workbook.worksheets.find(
          (sheet) => sheet.state === 'visible' && sheet.actualRowCount > 0,
        ) ?? workbook.worksheets[0]
      );
    }
    // The identity map keeps every cell as the text in the file. ExcelJS's default
    // map turns number-like text into numbers and dates into local-time Dates, which
    // dropped a phone's leading 0 and "+" and moved a date back a day east of UTC.
    return await workbook.csv.read(Readable.from(file.buffer), {
      map: (value: string) => value,
    });
  } catch (error) {
    logger.warn(`Unreadable import file: ${(error as Error).message}`);
    throw new BadRequestException(
      'The file could not be read. Check that it is a valid CSV or XLSX file.',
    );
  }
}

function pad(cells: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => cells[index] ?? '');
}

/**
 * Postgres text cannot hold NUL, and an XLSX cell can carry one as `_x0000_`: left in,
 * it passes validation and then fails its whole batch (or the job's JSON) on write.
 */
function clean(text: string): string {
  return text.replaceAll('\u0000', '').trim();
}

/** Flattens every ExcelJS cell shape (rich text, formula, hyperlink, date) to text. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return clean(value);
  // At Excel's own 15 significant digits: a computed 449.7 is stored as
  // 449.70000000000005, which the user never sees and an amount check would refuse.
  if (typeof value === 'number') return String(Number(value.toPrecision(15)));
  if (typeof value === 'boolean') return String(value);
  // A date-formatted cell holding a huge number is an Invalid Date (Excel shows ####).
  // Kept as that text, not blank, so the field's own check reports the row.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? 'Invalid Date'
      : value.toISOString().slice(0, 10);
  }

  if (typeof value === 'object') {
    // A hyperlink's text may itself be rich text.
    if ('text' in value) return cellToString(value.text);
    if ('richText' in value && Array.isArray(value.richText)) {
      return clean(value.richText.map((part) => part.text).join(''));
    }
    if ('result' in value) return cellToString(value.result ?? '');
    // "#N/A" as the CSV path would carry it, so it is checked rather than read as blank.
    if ('error' in value) return String(value.error);
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return clean(value.hyperlink);
    }
  }

  return '';
}
