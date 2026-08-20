import { Prisma } from '../../generated/prisma/client';

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
  assignedAgents: { id: string; name: string }[];
  tags: { id: string; name: string }[];
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
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
  tags: {
    select: { tag: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_LIST_SELECT }>;

/**
 * Everything the Edit Lead form needs to prefill — a superset of the list
 * projection with the fields the list never shows (products, address, payment,
 * the raw complaint text). Kept separate from LEAD_LIST_SELECT so the 100-row
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
  };
}

/**
 * One entry in the Lead Detail timeline (Lead Detail drawer). Built by aggregating
 * data the system actually records — the lead's own `createdAt`, its assignment
 * rows, and its notes — never a fabricated event. Email sends and the actor who
 * created/assigned a lead are not tracked today, so those are deliberately absent
 * rather than invented (partial-but-honest timeline).
 */
export type LeadTimelineEvent =
  | { id: string; type: 'created'; at: string }
  | { id: string; type: 'assigned'; at: string; assigneeName: string }
  | { id: string; type: 'note'; at: string; authorName: string; body: string };

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
  ];
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
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
    assignedAgents: row.assignments.map((a) => a.user),
    tags: row.tags.map((t) => t.tag),
    isPinned,
  };
}
