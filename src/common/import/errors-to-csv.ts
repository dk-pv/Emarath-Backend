import { RowError } from './import-descriptor';

/**
 * Renders the standardized row errors as a CSV the user can open, fix and re-import
 * (LEAD-07.1 AC2 / LEAD-07.2 AC4).
 *
 * Columns are `Row Number, Error Code, Reason` followed by every original file
 * column that appears across the errors, so a failed row carries back exactly the
 * data the user submitted alongside the reason it was rejected.
 */
export function errorsToCsv(errors: RowError[]): string {
  const valueColumns = collectValueColumns(errors);
  const header = ['Row Number', 'Error Code', 'Reason', ...valueColumns];

  const lines = errors.map((error) =>
    [
      String(error.rowNumber),
      error.errorCode,
      error.reason,
      ...valueColumns.map((column) => error.values[column] ?? ''),
    ]
      .map(escapeCsv)
      .join(','),
  );

  return [header.map(escapeCsv).join(','), ...lines].join('\r\n');
}

/** The union of original-value columns, in first-seen order. */
function collectValueColumns(errors: RowError[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    for (const column of Object.keys(error.values)) {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    }
  }
  return columns;
}

/** A signed number ("-5", "+12.50") or an international phone number ("+1 (555) 123-4567"). */
const NUMBER_OR_PHONE = /^(?:[+-]?\d+(?:\.\d+)?|\+\d[\d ()-]*\d)$/;

/**
 * One CSV field, as every CSV this app writes — the lead export, the report exports, the import
 * error file and sample — spells it.
 *
 * A spreadsheet runs a cell that starts with = + - @, a tab or a carriage return as a formula,
 * so untrusted text could plant one (CSV injection, ADR-0095). Such a cell gets a leading
 * apostrophe, which spreadsheets read as "this is text". A plain number or phone number holds
 * no formula — "-5", "+971501234567", "+971 50 123 4567" — and is written as it is.
 *
 * Then RFC 4180: quoted when it contains a comma, quote or newline, inner quotes doubled.
 */
export function escapeCsv(value: string): string {
  const cell =
    /^[=+\-@\t\r]/.test(value) && !NUMBER_OR_PHONE.test(value)
      ? `'${value}`
      : value;
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}
