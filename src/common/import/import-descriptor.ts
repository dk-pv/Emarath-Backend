/**
 * The module-agnostic contract the import engine runs against (LEAD-07.1).
 *
 * A descriptor is everything that differs between importing Leads and importing
 * (later) Customers, Products or Vendors: the target fields, how a duplicate is
 * detected, how a validated row becomes a persistable record, and how a batch is
 * written. The engine owns everything that does not differ — parsing, mapping,
 * validation, dedupe orchestration, batching and progress — so a second module is
 * a new descriptor, not a new pipeline.
 */

/** How a field's raw string is validated and later coerced by the descriptor. */
export type ImportFieldType = 'string' | 'decimal' | 'int' | 'date';

export interface ImportField {
  /** Internal key a column maps to (e.g. "primaryPhone"). */
  value: string;
  /** Human label shown in the Map Fields dropdown (e.g. "Primary Phone"). */
  label: string;
  type: ImportFieldType;
  /** A required field must be mapped and non-empty on every row. */
  required?: boolean;
  /** Max characters for a `string` field, mirroring the column length. */
  maxLength?: number;
}

/** The machine codes attached to a rejected/skipped row (see the API contract). */
export type ImportErrorCode =
  | 'REQUIRED_FIELD_MISSING'
  | 'INVALID_NUMBER'
  | 'INVALID_DATE'
  | 'VALUE_TOO_LONG'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_EXISTING'
  | 'ROW_EMPTY';

export type RowStatus = 'valid' | 'invalid' | 'duplicate';

/** The standardized row-error object persisted on the job and shown in the report. */
export interface RowError {
  rowNumber: number;
  values: Record<string, string>;
  reason: string;
  errorCode: ImportErrorCode;
}

/** One evaluated data row: its verdict, plus the cleaned values a valid row carries. */
export interface EvaluatedRow {
  rowNumber: number;
  /** The original row keyed by the file's column headers. */
  values: Record<string, string>;
  /** Field value → cleaned string, populated only for a `valid` row. */
  mapped: Record<string, string>;
  status: RowStatus;
  error: { reason: string; errorCode: ImportErrorCode } | null;
}

/**
 * A per-module import definition.
 *
 * `TPrepared` is whatever `buildRecord` produces and `persistBatch` consumes — the
 * engine never inspects it, so each module keeps its own persistence shape (for
 * Leads, a create-many row plus an optional assignment).
 */
export interface ImportDescriptor<TPrepared, TContext> {
  module: string;
  fields: readonly ImportField[];
  /** Field value used to dedupe (e.g. "primaryPhone"), or null to skip dedupe. */
  dedupeField: string | null;
  /**
   * Given the dedupe values present in the file, the subset that already exists in
   * the database. Kept on the descriptor so dedupe stays a query, never a full scan.
   */
  findExistingDuplicates(values: string[]): Promise<Set<string>>;
  /** Turn one validated, mapped row into a persistable record. */
  buildRecord(mapped: Record<string, string>, context: TContext): TPrepared;
  /** Persist a batch atomically (one transaction per batch). */
  persistBatch(records: TPrepared[], context: TContext): Promise<void>;
}
