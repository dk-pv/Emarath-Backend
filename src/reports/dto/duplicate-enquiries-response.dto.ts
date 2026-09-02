import { Prisma } from '../../generated/prisma/client';

/** How many extra enquiries a card counts; the reference shows 1+ through 5+. */
export const DUPLICATE_THRESHOLDS = [1, 2, 3, 4, 5] as const;

/**
 * One card per threshold: how many leads share their phone with at least that many
 * others. A group of `k` leads gives each of its members `k - 1` duplicates.
 */
export interface DuplicateEnquiriesKpis {
  /** Keyed by threshold — `{ "1": 12, "2": 4, … }`. */
  leadsWithAtLeast: Record<string, number>;
}

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface DuplicateEnquiriesAgentRef {
  id: string;
  name: string;
}

/** One duplicate group: the leads that share a primary phone. */
export interface DuplicateEnquiryRow {
  /** The group's key — the shared primary phone. */
  id: string;
  /** The most recent enquiry's name, which is how the group is recognised. */
  name: string;
  primaryPhone: string;
  /** The other fields, taken from the most recent enquiry in the group. */
  secondaryPhone: string | null;
  primaryEmail: string | null;
  secondaryEmail: string | null;
  /** How many enquiries share this phone (the group's size). */
  duplicateCount: number;
  /** The newest enquiry's creation instant. */
  latestEnquiryAt: string;
  /** Every distinct assignee across the group. */
  assignedTo: DuplicateEnquiriesAgentRef[];
  /** Every distinct source the group's enquiries came through. */
  sources: string[];
}

export interface DuplicateEnquiriesListResponse {
  rows: DuplicateEnquiryRow[];
  /** How many duplicate groups the filters leave. */
  total: number;
}

export interface DuplicateEnquiriesSummaryResponse {
  kpis: DuplicateEnquiriesKpis;
}

/** The projection the grouping reads: identity, contacts, source and assignees. */
export const DUPLICATE_ENQUIRIES_SELECT = {
  id: true,
  name: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  source: true,
  createdAt: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;
