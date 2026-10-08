import { ActivityType, Prisma } from '../generated/prisma/client';
import { escapeLike } from '../leads/lead-search';

/**
 * Free-text search over the worklist (ACT-07.1 AC1): Customer Name and the
 * activity title. The title is derived ("{Type} with {name}"), never stored, so a
 * term matches it exactly when it falls inside one of three parts: the customer
 * name; the "{Type} with " prefix ("eting", "Call with"); or across the two, a
 * tail of the prefix followed by the start of the name ("with Om", "Meeting with
 * Omar"). Each part is a plain Prisma predicate, so the page and the tab counts
 * share one `where`. Reuses the Leads `escapeLike` so `%`/`_` are literal. An
 * empty term adds no condition (AC5).
 */
export function activitySearchWhere(
  term: string | undefined,
): Prisma.ActivityWhereInput | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;

  const or: Prisma.ActivityWhereInput[] = [
    {
      lead: {
        name: { contains: escapeLike(trimmed), mode: 'insensitive' },
      },
    },
  ];

  const t = trimmed.toLowerCase();
  for (const [label, type] of Object.entries(TYPE_LABELS)) {
    const prefix = `${label} with `;
    if (prefix.includes(t)) {
      or.push({ type });
      continue;
    }
    for (let split = 1; split < t.length; split++) {
      if (!prefix.endsWith(t.slice(0, split))) continue;
      or.push({
        type,
        lead: {
          name: {
            startsWith: escapeLike(trimmed.slice(split)),
            mode: 'insensitive',
          },
        },
      });
    }
  }

  return { OR: or };
}

/** The title's type labels, lower-cased (`activityTitle` in activity-response.dto.ts). */
const TYPE_LABELS: Record<Lowercase<string>, ActivityType> = {
  call: ActivityType.CALL,
  meeting: ActivityType.MEETING,
  task: ActivityType.TASK,
};

export interface ActivityFilters {
  /** User ids matched through the assignee join (AC2). */
  assignedAgent?: string[];
  /** Lead status values, matched on the linked lead (AC2). */
  status?: string[];
  /** Lead pipeline values, matched on the linked lead (AC2). */
  pipeline?: string[];
  /** Follow-up types — the popup's "All Activities" dropdown (AC2). */
  type?: ActivityType[];
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
  if (filters.type?.length) {
    conditions.push({ type: { in: filters.type } });
  }

  return conditions;
}
