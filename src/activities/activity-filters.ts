import { ActivityType, Prisma } from '../generated/prisma/client';
import { escapeLike } from '../leads/lead-search';

/**
 * Free-text search over the worklist (ACT-07.1 AC1): Customer Name and the
 * activity title. The title is derived ("{Type} with {name}"), never stored, so
 * the customer-name half is matched on the linked lead and the title's only other
 * word — the type label — is matched when the term is a prefix of it ("cal" →
 * CALL). Reuses the Leads `escapeLike` so `%`/`_` are literal. An empty term adds
 * no condition (AC5).
 */
export function activitySearchWhere(
  term: string | undefined,
): Prisma.ActivityWhereInput | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;

  const needle = escapeLike(trimmed);
  const or: Prisma.ActivityWhereInput[] = [
    { lead: { name: { contains: needle, mode: 'insensitive' } } },
  ];

  const type = matchTypeLabel(trimmed);
  if (type) or.push({ type });

  return { OR: or };
}

const TYPE_LABELS: Record<Lowercase<string>, ActivityType> = {
  call: ActivityType.CALL,
  meeting: ActivityType.MEETING,
  task: ActivityType.TASK,
};

/** The type whose label the term is a prefix of ("meet" → MEETING), or none. */
function matchTypeLabel(term: string): ActivityType | undefined {
  const t = term.toLowerCase();
  for (const [label, type] of Object.entries(TYPE_LABELS)) {
    if (label.startsWith(t)) return type;
  }
  return undefined;
}

export interface ActivityFilters {
  /** User ids matched through the assignee join (AC2). */
  assignedAgent?: string[];
  /** Lead status values, matched on the linked lead (AC2). */
  status?: string[];
  /** Lead pipeline values, matched on the linked lead (AC2). */
  pipeline?: string[];
}

/**
 * The active field-filter fragments (ACT-07.1 AC2). One per present filter; the
 * service ANDs them with scope, the bucket and search so all apply together and
 * no filter widens another's reach (an agent filtering by a colleague still sees
 * only their own activities). Values OR within a field via `IN`. Status and
 * Pipeline live on the linked lead; Assigned matches through the assignee join.
 */
export function activityFilterWhere(
  filters: ActivityFilters,
): Prisma.ActivityWhereInput[] {
  const conditions: Prisma.ActivityWhereInput[] = [];

  if (filters.assignedAgent?.length) {
    conditions.push({
      assignees: { some: { userId: { in: filters.assignedAgent } } },
    });
  }
  if (filters.status?.length) {
    conditions.push({ lead: { status: { in: filters.status } } });
  }
  if (filters.pipeline?.length) {
    conditions.push({ lead: { pipeline: { in: filters.pipeline } } });
  }

  return conditions;
}
