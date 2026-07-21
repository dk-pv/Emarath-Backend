import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** A selection is bounded by what a user can check; this caps abuse, not real use. */
export const MAX_BULK_IDS = 1000;

/** Bulk delete (LEAD-09.1): the selected lead ids to remove. */
export class BulkDeleteDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'ids must not be empty' })
  @ArrayMaxSize(MAX_BULK_IDS, {
    message: `ids accepts at most ${MAX_BULK_IDS} values`,
  })
  @IsUUID('all', { each: true, message: 'each id must be a valid lead id' })
  ids!: string[];
}

/** Bulk reassign (LEAD-09.1): the selected leads and the agent to own them. */
export class BulkReassignDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'ids must not be empty' })
  @ArrayMaxSize(MAX_BULK_IDS, {
    message: `ids accepts at most ${MAX_BULK_IDS} values`,
  })
  @IsUUID('all', { each: true, message: 'each id must be a valid lead id' })
  ids!: string[];

  @IsUUID('all', { message: 'agentId must be a valid user id' })
  agentId!: string;
}

export type BulkItemStatus = 'success' | 'failed';

/** The fate of one requested id — successes and failures are both reported (AC3). */
export interface BulkItemResult {
  id: string;
  status: BulkItemStatus;
  reason?: string;
}

export interface BulkActionResponse {
  results: BulkItemResult[];
  summary: { total: number; success: number; failed: number };
}

/** Why an id was not acted on: it is outside the caller's scope or does not exist. */
export const OUT_OF_SCOPE_REASON = 'Lead not found or not permitted.';

/**
 * Maps each requested id to its result: `success` when it was actionable (in the
 * caller's scope and acted on), `failed` otherwise. Shared by reassign and delete so
 * the per-item contract is built one way.
 */
export function bulkResponse(
  requestedIds: string[],
  actionable: ReadonlySet<string>,
): BulkActionResponse {
  const results: BulkItemResult[] = requestedIds.map((id) =>
    actionable.has(id)
      ? { id, status: 'success' }
      : { id, status: 'failed', reason: OUT_OF_SCOPE_REASON },
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
