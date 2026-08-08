import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** A selection is bounded by what a user can check; this caps abuse, not real use. */
export const MAX_BULK_IDS = 1000;

/** Bulk delete (DOC-08.1): the selected document ids to remove. */
export class BulkDeleteDocumentsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'ids must not be empty' })
  @ArrayMaxSize(MAX_BULK_IDS, {
    message: `ids accepts at most ${MAX_BULK_IDS} values`,
  })
  @IsUUID('all', { each: true, message: 'each id must be a valid document id' })
  ids!: string[];
}

export type BulkItemStatus = 'success' | 'failed';

/** The fate of one requested id — successes and failures are both reported (AC4). */
export interface BulkItemResult {
  id: string;
  status: BulkItemStatus;
  reason?: string;
}

export interface BulkActionResponse {
  results: BulkItemResult[];
  summary: { total: number; success: number; failed: number };
}

/** Why an id was not acted on: it is not deletable by the caller, out of scope, or gone. */
export const NOT_DELETABLE_REASON =
  'Document not found or not permitted to delete.';

/**
 * Maps each requested id to its result: `success` when it was actionable (the caller may
 * delete it and it was removed), `failed` otherwise (DOC-08.1 AC4). Mirrors the Leads
 * bulk contract; kept local so the Documents module stays independent (like `escapeLike`).
 */
export function documentBulkResponse(
  requestedIds: string[],
  actionable: ReadonlySet<string>,
): BulkActionResponse {
  const results: BulkItemResult[] = requestedIds.map((id) =>
    actionable.has(id)
      ? { id, status: 'success' }
      : { id, status: 'failed', reason: NOT_DELETABLE_REASON },
  );
  const success = results.filter(
    (result) => result.status === 'success',
  ).length;
  return {
    results,
    summary: {
      total: results.length,
      success,
      failed: results.length - success,
    },
  };
}
