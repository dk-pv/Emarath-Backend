import { Prisma } from '../../../generated/prisma/client';
import {
  ImportErrorCode,
  RowStatus,
} from '../../../common/import/import-descriptor';

/** GET /fields — the target field catalog for the Map Fields step. */
export interface ImportFieldOption {
  value: string;
  label: string;
  required: boolean;
}

/** POST /parse — detected columns and a bounded preview. */
export interface ParseResult {
  columns: string[];
  preview: Record<string, string>[];
  totalRows: number;
}

/** One row in the validate preview, carrying its verdict and reason. */
export interface ValidatedRow {
  rowNumber: number;
  values: Record<string, string>;
  status: RowStatus;
  error: { reason: string; errorCode: ImportErrorCode } | null;
}

/** POST /validate — whole-file counts plus a bounded window of classified rows. */
export interface ValidateResult {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  rows: ValidatedRow[];
}

/** GET /:jobId — a single job's live state. */
export interface ImportJobResponse {
  id: string;
  module: string;
  status: string;
  fileName: string;
  pipeline: string;
  totalRows: number;
  processedRows: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  importedBy: { id: string; name: string } | null;
}

/** GET /history — a job summarised for the history table. */
export type ImportHistoryItem = ImportJobResponse;

/**
 * The columns every job read selects. `errors` is deliberately excluded — history
 * and polling never need the failed-row payload, which the dedicated errors
 * endpoint serves — so a poll every second stays small.
 */
export const IMPORT_JOB_SELECT = {
  id: true,
  module: true,
  status: true,
  fileName: true,
  pipeline: true,
  totalRows: true,
  processedRows: true,
  importedCount: true,
  skippedCount: true,
  failedCount: true,
  startedAt: true,
  completedAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ImportJobSelect;

/**
 * How long a PROCESSING job may go without progress before it reads as FAILED. Every
 * batch's progress write bumps `updatedAt`, and a batch is bounded by the transaction
 * timeout and wait (20 s + 15 s, PrismaService), so a job silent this long has lost its
 * writer to a restart, deploy or crash. Decided on read: no startup sweep, so boot never
 * waits on the database (CLAUDE.md §9) and a job an older instance is still writing
 * during a deploy is never marked failed.
 */
export const STALE_PROCESSING_MS = 2 * 60 * 1000;

type ImportJobRow = Prisma.ImportJobGetPayload<{
  select: typeof IMPORT_JOB_SELECT;
}>;

export function toImportJobResponse(
  row: ImportJobRow,
  now = new Date(),
): ImportJobResponse {
  const stale =
    row.status === 'PROCESSING' &&
    now.getTime() - row.updatedAt.getTime() > STALE_PROCESSING_MS;
  return {
    id: row.id,
    module: row.module,
    status: stale ? 'FAILED' : row.status,
    fileName: row.fileName,
    pipeline: row.pipeline,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    importedCount: row.importedCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    importedBy: row.createdBy,
  };
}
