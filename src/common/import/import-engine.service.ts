import { Injectable } from '@nestjs/common';
import { validateField } from './field-validation';
import {
  EvaluatedRow,
  ImportDescriptor,
  ImportErrorCode,
} from './import-descriptor';
import { ParsedSheet } from './spreadsheet-parser';

/** Rows written per transaction — big enough to amortise round-trips, small
 * enough that one failed batch loses little and progress moves visibly. */
const BATCH_SIZE = 500;

export interface EvaluationSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
}

export interface EvaluationResult {
  rows: EvaluatedRow[];
  summary: EvaluationSummary;
}

/**
 * The reusable core of every import (LEAD-07.1).
 *
 * It maps file columns onto a descriptor's fields, validates and cleans each row,
 * detects duplicates (in-file and against the database), and writes the valid rows
 * in transactional batches while reporting progress. Nothing here knows about
 * Leads — the descriptor supplies the only module-specific behaviour — so the same
 * engine imports the next module unchanged.
 */
@Injectable()
export class ImportEngineService {
  /**
   * Classifies every data row as valid, invalid or duplicate without writing
   * anything. Used by the preview (to show counts and per-row reasons) and by the
   * import (to know which rows to persist and which to report).
   */
  async evaluate(
    sheet: ParsedSheet,
    mapping: Record<string, string | null>,
    descriptor: ImportDescriptor<unknown, unknown>,
  ): Promise<EvaluationResult> {
    const fieldColumnIndex = this.indexFieldsToColumns(sheet.headers, mapping);

    // Pass 1 — field validation + collect dedupe candidates.
    const staged = sheet.rows.map((cells, index) =>
      this.stageRow(sheet.headers, cells, index, descriptor, fieldColumnIndex),
    );

    const existing = await this.lookupExistingDuplicates(staged, descriptor);

    // Pass 2 — apply dedupe and settle each row's final status.
    const seenInFile = new Set<string>();
    const rows = staged.map((row) =>
      this.settleRow(row, descriptor, seenInFile, existing),
    );

    return { rows, summary: this.summarise(rows) };
  }

  /**
   * Persists the valid rows in transactional batches, invoking `onProgress` with
   * the running imported count after each batch. A batch is one transaction, so a
   * failure rolls back only its own batch; earlier batches stay committed and the
   * error surfaces to the caller (which marks the job failed).
   */
  async persistValid<TPrepared, TContext>(
    rows: EvaluatedRow[],
    descriptor: ImportDescriptor<TPrepared, TContext>,
    context: TContext,
    onProgress: (importedSoFar: number) => Promise<void>,
  ): Promise<number> {
    const valid = rows.filter((row) => row.status === 'valid');
    let imported = 0;

    for (let start = 0; start < valid.length; start += BATCH_SIZE) {
      const slice = valid.slice(start, start + BATCH_SIZE);
      const records = slice.map((row) =>
        descriptor.buildRecord(row.mapped, context),
      );
      await descriptor.persistBatch(records, context);
      imported += slice.length;
      await onProgress(imported);
    }

    return imported;
  }

  /** column header → its position, then field value → that column's position. */
  private indexFieldsToColumns(
    headers: string[],
    mapping: Record<string, string | null>,
  ): Map<string, number> {
    const columnPosition = new Map<string, number>();
    headers.forEach((header, index) => columnPosition.set(header, index));

    const fieldColumnIndex = new Map<string, number>();
    for (const [column, fieldValue] of Object.entries(mapping)) {
      const position = columnPosition.get(column);
      if (fieldValue && position !== undefined) {
        fieldColumnIndex.set(fieldValue, position);
      }
    }
    return fieldColumnIndex;
  }

  private stageRow(
    headers: string[],
    cells: string[],
    index: number,
    descriptor: ImportDescriptor<unknown, unknown>,
    fieldColumnIndex: Map<string, number>,
  ): EvaluatedRow {
    const values: Record<string, string> = {};
    headers.forEach((header, position) => {
      values[header] = cells[position] ?? '';
    });

    const mapped: Record<string, string> = {};
    const failures: { errorCode: ImportErrorCode; reason: string }[] = [];
    let anyMappedValue = false;

    for (const field of descriptor.fields) {
      const position = fieldColumnIndex.get(field.value);
      const raw = position === undefined ? '' : (cells[position] ?? '');
      if (raw.trim() !== '') anyMappedValue = true;

      const result = validateField(field, raw);
      if (result.ok) {
        if (result.value !== '') mapped[field.value] = result.value;
      } else {
        failures.push(result.failure);
      }
    }

    // A row with data only in unmapped columns has nothing to import.
    if (failures.length === 0 && !anyMappedValue) {
      failures.push({
        errorCode: 'ROW_EMPTY',
        reason: 'Row has no values in any mapped column',
      });
    }

    const error = failures.length
      ? {
          errorCode: failures[0].errorCode,
          reason: failures.map((failure) => failure.reason).join('; '),
        }
      : null;

    return {
      // Row 1 is the header, so the first data row is row 2.
      rowNumber: index + 2,
      values,
      mapped,
      status: error ? 'invalid' : 'valid',
      error,
    };
  }

  private async lookupExistingDuplicates(
    staged: EvaluatedRow[],
    descriptor: ImportDescriptor<unknown, unknown>,
  ): Promise<Set<string>> {
    if (!descriptor.dedupeField) return new Set();

    const field = descriptor.dedupeField;
    const candidates = staged
      .filter((row) => row.status === 'valid')
      .map((row) => row.mapped[field])
      .filter((value): value is string => Boolean(value));

    if (candidates.length === 0) return new Set();
    return descriptor.findExistingDuplicates([...new Set(candidates)]);
  }

  private settleRow(
    row: EvaluatedRow,
    descriptor: ImportDescriptor<unknown, unknown>,
    seenInFile: Set<string>,
    existing: Set<string>,
  ): EvaluatedRow {
    if (row.status === 'invalid' || !descriptor.dedupeField) return row;

    const value = row.mapped[descriptor.dedupeField];
    if (!value) return row;

    const duplicate = (
      errorCode: ImportErrorCode,
      reason: string,
    ): EvaluatedRow => ({
      ...row,
      status: 'duplicate',
      error: { errorCode, reason },
    });

    if (seenInFile.has(value)) {
      return duplicate(
        'DUPLICATE_IN_FILE',
        'A row earlier in the file has the same Primary Phone',
      );
    }
    if (existing.has(value)) {
      return duplicate(
        'DUPLICATE_EXISTING',
        'A lead with this Primary Phone already exists',
      );
    }

    seenInFile.add(value);
    return row;
  }

  private summarise(rows: EvaluatedRow[]): EvaluationSummary {
    let valid = 0;
    let invalid = 0;
    let duplicates = 0;
    for (const row of rows) {
      if (row.status === 'valid') valid += 1;
      else if (row.status === 'duplicate') duplicates += 1;
      else invalid += 1;
    }
    return { total: rows.length, valid, invalid, duplicates };
  }
}
