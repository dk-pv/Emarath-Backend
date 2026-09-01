import { CallDirection, Prisma } from '../../generated/prisma/client';

/**
 * The shape the list endpoint returns for one lead.
 *
 * Amounts are strings, not numbers: they are DECIMAL in Postgres, and JSON
 * numbers are IEEE doubles, so serialising them as numbers reintroduces exactly
 * the rounding the Decimal column exists to prevent.
 */
export interface LeadListItem {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  source: string | null;
  status: string;
  pipeline: string;
  category: string | null;
  actualAmount: string | null;
  forecastedAmount: string | null;
  bookingDate: string | null;
  callStatus: string | null;
  callAttempts: number;
  whatsappAttempts: number;
  createdAt: string;
  /** Last write to the lead row — the Lead Detail header's "Last Updated" line. */
  updatedAt: string;
  /** Address parts the board card joins into its one location line (KAN-03.1). */
  state: string | null;
  street: string | null;
  city: string | null;
  /** The remaining Workpex list columns (LEAD-02.2): order, payment and identity fields. */
  product: string | null;
  productQty: string | null;
  product2: string | null;
  product2Qty: string | null;
  paymentMethod: string | null;
  nationalCode: string | null;
  /** The latest open complaint's reason — Workpex's "COMPLAINTS" column; null when none. */
  complaintReason: string | null;
  /** The latest assignment's instant — "Assigned Date"; null when unassigned. */
  assignedDate: string | null;
  /** False until the lead has a completed activity or a logged call — the list's warning triangle. */
  hasActivity: boolean;
  assignedAgents: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  /**
   * LEAD-05.1 (ADR-0051): per-lead custom-column values, keyed by the field's stable
   * "cf_<slug>" key. Only active fields with a value appear; an absent key is a blank
   * cell. The table's custom columns read `row.customFields[column.key]`.
   */
  customFields: Record<string, string>;
  /**
   * Whether the CURRENT caller has pinned this lead (ADR-0031) — personal, not
   * shared. Not a column on the lead: it is derived per-request from `lead_pins`,
   * so it is passed in rather than read off `row`. Defaults false, so the many
   * mappers that never surface a pin (Kanban card, Activities' nested lead, the
   * status/tag/reassign responses) need no change.
   */
  isPinned: boolean;
}

/** Page plus total (CLAUDE.md §8) — mirrors the frontend's `ListResult`. */
export interface LeadListResponse {
  rows: LeadListItem[];
  total: number;
}

/**
 * The exact rows the mapper needs. Declared once so the query and the mapper
 * cannot drift apart, and so nothing wider is fetched by accident — a user's
 * email must never ride along on a lead.
 */
export const LEAD_LIST_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  language: true,
  country: true,
  source: true,
  status: true,
  pipeline: true,
  category: true,
  actualAmount: true,
  forecastedAmount: true,
  bookingDate: true,
  callStatus: true,
  callAttempts: true,
  whatsappAttempts: true,
  createdAt: true,
  updatedAt: true,
  /**
   * The board card's address line (KAN-03.1): Workpex prints a location under the
   * phone on the cards that have one — see the pinned addresses in
   * `ui-reference/Kanban/kanban-lead-pipeline-dropdown-open-card-hover.png`. Three
   * short varchars on a query that already projects ~20 scalars and is page-capped,
   * so the list stays as narrow as it needs to be; the composition into one line is
   * the client's, as with every other formatted value here.
   */
  state: true,
  street: true,
  city: true,
  product: true,
  productQty: true,
  product2: true,
  product2Qty: true,
  paymentMethod: true,
  nationalCode: true,
  /** The latest open complaint only — one nested row per lead, so the page stays bounded. */
  complaints: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { details: true },
  },
  assignments: {
    select: { createdAt: true, user: { select: { id: true, name: true } } },
  },
  tags: {
    select: { tag: { select: { id: true, name: true } } },
  },
  /**
   * LEAD-05.1 (ADR-0051): this page's leads' custom-column values, batched by Prisma
   * as one nested read (no N+1). Only active fields' values are projected; the field's
   * stable `key` keys the response map. Bounded by (#fields × pageSize).
   */
  customFieldValues: {
    where: { customField: { deletedAt: null } },
    select: { value: true, customField: { select: { key: true } } },
  },
  /**
   * Whether the lead has been worked at all — the Leads list's warning triangle. The same
   * definition the No Activity Leads report uses (a completed activity or a logged call), as
   * two filtered relation counts in the one query — no per-row lookups.
   */
  _count: {
    select: {
      activities: { where: { deletedAt: null, completedAt: { not: null } } },
      calls: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_LIST_SELECT }>;

/**
 * Everything the Edit Lead form needs to prefill — a superset of the list
 * projection with the fields the list never shows (products, payment, the national
 * code, the raw complaint text). Kept separate from LEAD_LIST_SELECT so the 100-row
 * list query stays narrow; this wider read only runs when one lead is opened for
 * editing. `complaints` returns just the latest open one — the form's single
 * COMPLAINTS field mirrors that one, matching how create seeds it.
 */
export const LEAD_EDIT_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  language: true,
  country: true,
  source: true,
  status: true,
  pipeline: true,
  product: true,
  productQty: true,
  product2: true,
  product2Qty: true,
  bookingDate: true,
  category: true,
  actualAmount: true,
  forecastedAmount: true,
  paymentMethod: true,
  state: true,
  street: true,
  city: true,
  nationalCode: true,
  callStatus: true,
  callAttempts: true,
  whatsappAttempts: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
  tags: { select: { tagId: true } },
  complaints: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { details: true },
  },
  /** LEAD-05.1 (ADR-0051): the lead's custom values, so Edit-mode prefills them. */
  customFieldValues: {
    where: { customField: { deletedAt: null } },
    select: { value: true, customField: { select: { key: true } } },
  },
} satisfies Prisma.LeadSelect;

type LeadEditRow = Prisma.LeadGetPayload<{ select: typeof LEAD_EDIT_SELECT }>;

/**
 * The Edit Lead form's prefill payload. Mirrors CreateLeadDto's fields (plus the
 * lead id) so the one shared form can round-trip: read here, edit, PUT back. The
 * form's `msgAttempts` is this lead's `whatsappAttempts` — the same rename create
 * applies in reverse. Assigned agents carry their names so the MultiSelect can
 * label a chip for an assignee who is not in the assignable list (e.g. an admin).
 */
export interface LeadEditData {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  source: string | null;
  status: string;
  pipeline: string;
  product: string | null;
  productQty: string | null;
  product2: string | null;
  product2Qty: string | null;
  bookingDate: string | null;
  category: string | null;
  actualAmount: string | null;
  forecastedAmount: string | null;
  paymentMethod: string | null;
  state: string | null;
  street: string | null;
  city: string | null;
  nationalCode: string | null;
  callStatus: string | null;
  callAttempts: number;
  msgAttempts: number;
  assignedAgents: { id: string; name: string }[];
  tagIds: string[];
  complaintReason: string | null;
  /** LEAD-05.1 (ADR-0051): custom values keyed by field key, so Edit prefills them. */
  customFields: Record<string, string>;
}

/** Date-only in the database; keep it date-only on the wire. */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toLeadEditData(row: LeadEditRow): LeadEditData {
  return {
    id: row.id,
    name: row.name,
    firstName: row.firstName,
    primaryPhone: row.primaryPhone,
    secondaryPhone: row.secondaryPhone,
    email: row.email,
    language: row.language,
    country: row.country,
    source: row.source,
    status: row.status,
    pipeline: row.pipeline,
    product: row.product,
    productQty: row.productQty?.toString() ?? null,
    product2: row.product2,
    product2Qty: row.product2Qty?.toString() ?? null,
    bookingDate: toDateOnly(row.bookingDate),
    category: row.category,
    actualAmount: row.actualAmount?.toString() ?? null,
    forecastedAmount: row.forecastedAmount?.toString() ?? null,
    paymentMethod: row.paymentMethod,
    state: row.state,
    street: row.street,
    city: row.city,
    nationalCode: row.nationalCode,
    callStatus: row.callStatus,
    callAttempts: row.callAttempts,
    msgAttempts: row.whatsappAttempts,
    assignedAgents: row.assignments.map((a) => a.user),
    tagIds: row.tags.map((t) => t.tagId),
    complaintReason: row.complaints[0]?.details ?? null,
    customFields: Object.fromEntries(
      row.customFieldValues.map((v) => [v.customField.key, v.value]),
    ),
  };
}

/**
 * One entry in the Lead Detail timeline (Lead Detail drawer). Built by aggregating
 * data the system actually records — the lead's own `createdAt`, its assignment
 * rows, its notes and its calls — never a fabricated event. Email sends and the actor
 * who created/assigned a lead are not tracked today, so those are deliberately absent
 * rather than invented (partial-but-honest timeline).
 */
export type LeadTimelineEvent =
  | { id: string; type: 'created'; at: string }
  | { id: string; type: 'assigned'; at: string; assigneeName: string }
  | { id: string; type: 'note'; at: string; authorName: string; body: string }
  | {
      id: string;
      type: 'call';
      at: string;
      direction: CallDirection;
      agentName: string;
    };

/**
 * Merges a lead's created/assigned/note facts into one newest-first feed. Pure, so
 * it is unit-tested directly. ISO timestamps sort lexicographically in time order.
 */
export function buildLeadTimeline(
  leadId: string,
  createdAt: Date,
  assignments: { id: string; createdAt: Date; user: { name: string } }[],
  notes: {
    id: string;
    createdAt: Date;
    body: string;
    author: { name: string };
  }[],
  calls: {
    id: string;
    startedAt: Date;
    direction: CallDirection;
    agent: { name: string };
  }[] = [],
): LeadTimelineEvent[] {
  const events: LeadTimelineEvent[] = [
    { id: `created:${leadId}`, type: 'created', at: createdAt.toISOString() },
    ...assignments.map((a) => ({
      id: `assigned:${a.id}`,
      type: 'assigned' as const,
      at: a.createdAt.toISOString(),
      assigneeName: a.user.name,
    })),
    ...notes.map((n) => ({
      id: `note:${n.id}`,
      type: 'note' as const,
      at: n.createdAt.toISOString(),
      authorName: n.author.name,
      body: n.body,
    })),
    ...calls.map((c) => ({
      id: `call:${c.id}`,
      type: 'call' as const,
      at: c.startedAt.toISOString(),
      direction: c.direction,
      agentName: c.agent.name,
    })),
  ];
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * One of a lead's follow-ups for the Lead Detail drawer (ACT-03.2 / ACT-04.1). The
 * drawer derives its "Next Follow-up" card (the earliest incomplete one) and its
 * "Follow Up … Created/Completed" timeline entries from this list. `type` is the
 * ActivityType enum value; times are ISO. The actor who created/completed it is not
 * recorded on `Activity`, so it is deliberately absent (partial-but-honest).
 */
export interface LeadActivity {
  id: string;
  type: string;
  description: string | null;
  dueAt: string;
  endAt: string | null;
  completedAt: string | null;
  createdAt: string;
  assignees: { id: string; name: string }[];
}

export function toLeadActivity(row: {
  id: string;
  type: string;
  description: string | null;
  dueAt: Date;
  endAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  assignees: { user: { id: string; name: string } }[];
}): LeadActivity {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    dueAt: row.dueAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    assignees: row.assignees.map((a) => a.user),
  };
}

export function toLeadListItem(row: LeadRow, isPinned = false): LeadListItem {
  return {
    id: row.id,
    name: row.name,
    firstName: row.firstName,
    primaryPhone: row.primaryPhone,
    secondaryPhone: row.secondaryPhone,
    email: row.email,
    language: row.language,
    country: row.country,
    source: row.source,
    status: row.status,
    pipeline: row.pipeline,
    category: row.category,
    actualAmount: row.actualAmount?.toString() ?? null,
    forecastedAmount: row.forecastedAmount?.toString() ?? null,
    bookingDate: toDateOnly(row.bookingDate),
    callStatus: row.callStatus,
    callAttempts: row.callAttempts,
    whatsappAttempts: row.whatsappAttempts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    state: row.state,
    street: row.street,
    city: row.city,
    product: row.product,
    productQty: row.productQty?.toString() ?? null,
    product2: row.product2,
    product2Qty: row.product2Qty?.toString() ?? null,
    paymentMethod: row.paymentMethod,
    nationalCode: row.nationalCode,
    complaintReason: row.complaints[0]?.details ?? null,
    assignedDate:
      row.assignments
        .reduce<Date | null>(
          (latest, a) =>
            latest === null || a.createdAt > latest ? a.createdAt : latest,
          null,
        )
        ?.toISOString() ?? null,
    assignedAgents: row.assignments.map((a) => a.user),
    tags: row.tags.map((t) => t.tag),
    customFields: Object.fromEntries(
      row.customFieldValues.map((v) => [v.customField.key, v.value]),
    ),
    hasActivity: row._count.activities > 0 || row._count.calls > 0,
    isPinned,
  };
}
