import { Prisma } from '../../generated/prisma/client';

/** The bucket label for leads whose `source` is null or blank (AC1 accounts for every lead). */
export const NO_SOURCE_LABEL = 'No Source';

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface LeadsBySourceAgentRef {
  id: string;
  name: string;
}

/** One lead in the detailed view (RPT-02.4). `source` is null when none was recorded. */
export interface LeadsBySourceLeadRow {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  source: string | null;
  assignedTo: LeadsBySourceAgentRef[];
}

export interface LeadsBySourceListResponse {
  rows: LeadsBySourceLeadRow[];
  total: number;
}

/**
 * One breakdown row: the count of leads at a source (AC1/AC2). `source` is the acquisition
 * channel, or "No Source" for the null/blank bucket. Share is derived from `count`/`total` by
 * the client, so the row carries no rounded percentage.
 */
export interface SourceCountRow {
  source: string;
  count: number;
}

export interface LeadsBySourceSummaryResponse {
  rows: SourceCountRow[];
  /** Total leads across all sources (the scoped set) — the denominator for "share". */
  total: number;
}

/** The values the report's team filter offers (AC3). */
export interface LeadsBySourceFilterOptions {
  teams: string[];
}

/** The lead fields the report reads — identity, source and assignees only. */
export const LEADS_BY_SOURCE_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  source: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

type LeadsBySourceLead = Prisma.LeadGetPayload<{
  select: typeof LEADS_BY_SOURCE_SELECT;
}>;

/** Shapes a selected lead into a response row. */
export function toLeadsBySourceRow(
  lead: LeadsBySourceLead,
): LeadsBySourceLeadRow {
  return {
    id: lead.id,
    name: lead.name,
    firstName: lead.firstName,
    primaryPhone: lead.primaryPhone,
    source: lead.source,
    assignedTo: lead.assignments.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
  };
}
