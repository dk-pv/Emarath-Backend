import { Prisma } from '../generated/prisma/client';

/** What holds a lead in place: the records that depend on it, by kind. */
export interface LeadRetention {
  calls: number;
  /** 1 once the lead has been converted; a converted lead is never removed (ADR-0085 B15). */
  logisticsOrder: number;
}

/**
 * The leads, of those given, that must never be hard-deleted (ADR-0083).
 *
 * A lead other business records depend on carries history those records need. Calls came
 * first: CALL-01.1 made `calls.lead_id` ON DELETE RESTRICT, so the database already refuses
 * such a delete, and this reads the same rule first so the refusal is a clean 409 with an
 * audit event rather than a failed statement. Soft-deleted calls count too, exactly as the
 * foreign key counts them.
 *
 * A Logistics order holds its lead the same way (ADR-0085 B15): `logistics_orders.lead_id` is
 * RESTRICT, so a converted lead can never be hard-deleted — not by the row action, not by bulk
 * delete, and not by a path that forgets to ask.
 */
export async function retainedLeads(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, LeadRetention>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.lead.findMany({
    where: {
      id: { in: ids },
      OR: [{ calls: { some: {} } }, { logisticsOrder: { isNot: null } }],
    },
    select: {
      id: true,
      _count: { select: { calls: true } },
      logisticsOrder: { select: { id: true } },
    },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        calls: row._count.calls,
        logisticsOrder: row.logisticsOrder ? 1 : 0,
      },
    ]),
  );
}
