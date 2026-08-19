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

/** Date-only in the database; keep it date-only on the wire. */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
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
