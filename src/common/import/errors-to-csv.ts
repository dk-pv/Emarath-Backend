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

/** Quotes a field when it contains a comma, quote or newline; doubles inner quotes. */
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
