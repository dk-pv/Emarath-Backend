import { Prisma } from '../generated/prisma/client';

/**
 * The Sales Funnel's Full Funnel View counts a lead in every stage it has ever been in, not only
 * the one it sits in now (Workpex's Oct 2026 Full capture: New 7,358 of 8,359 leads, against 1,442
 * in Live). Those stages are the lead's current status plus both ends of every status move the
 * audit log holds for it (ADR-0083) — the first move's `before` being the stage the lead was
 * created in. Moves made before the log existed are not there to count.
 */

/** A scoped lead as the rollup reads it. */
export interface ProgressionLead {
  id: string;
  status: string;
  actualAmount: Prisma.Decimal | null;
}

/** One `STATUS_CHANGED` / `CONVERTED` event: the stage left and the stage entered. */
export interface StatusMove {
  leadId: string;
  createdAt: Date;
  from: string | null;
  to: string | null;
}

/**
 * A stage rename in the lead's pipeline. A rename relabels the leads in the stage in one
 * `updateMany` outside the per-lead log, so a move recorded before it names the old stage.
 */
export interface StageRename {
  at: Date;
  from: string;
  to: string;
}

/** Leads that have been in one stage, and their summed value. */
export interface StageProgression {
  count: number;
  value: Prisma.Decimal;
}

/**
 * What a stage recorded at `at` is called today: every later rename of that name, oldest first.
 * Time-aware, so a name reused by a new stage after a rename is not mistaken for the old one.
 */
export function stageNameNow(
  name: string,
  at: Date,
  renames: readonly StageRename[],
): string {
  let current = name;
  for (const rename of renames) {
    if (rename.at > at && rename.from === current) current = rename.to;
  }
  return current;
}

/**
 * Adds one batch of leads (with all of their moves) to `into`. Leads are disjoint across batches,
 * so each is counted once per stage however the batches fall. `renames` must be oldest first.
 */
export function addProgression(
  into: Map<string, StageProgression>,
  leads: readonly ProgressionLead[],
  moves: readonly StatusMove[],
  renames: readonly StageRename[],
): void {
  const stagesOf = new Map(
    leads.map((lead) => [lead.id, new Set([lead.status])]),
  );
  for (const move of moves) {
    const stages = stagesOf.get(move.leadId);
    if (!stages) continue;
    for (const name of [move.from, move.to]) {
      if (name) stages.add(stageNameNow(name, move.createdAt, renames));
    }
  }

  for (const lead of leads) {
    const value = lead.actualAmount ?? new Prisma.Decimal(0);
    for (const stage of stagesOf.get(lead.id) ?? []) {
      const total = into.get(stage);
      if (total) {
        total.count += 1;
        total.value = total.value.plus(value);
      } else {
        into.set(stage, { count: 1, value });
      }
    }
  }
}

/** A string field of an audit `before`/`after` snapshot — a move's `status`, a rename's `name`. */
export function snapshotField(
  snapshot: Prisma.JsonValue | null,
  key: string,
): string | null {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  if (Array.isArray(snapshot)) return null;
  const value = snapshot[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
