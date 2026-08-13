import { Prisma } from '../../generated/prisma/client';

/** The bucket label for leads with no assignment (existing project terminology). */
export const UNASSIGNED_LABEL = 'Unassigned';

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface LeadsByOwnershipAgentRef {
  id: string;
  name: string;
}

/** One lead in the detailed view (RPT-02.5) with its owner(s). */
export interface LeadsByOwnershipLeadRow {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  source: string | null;
  assignedTo: LeadsByOwnershipAgentRef[];
}

export interface LeadsByOwnershipListResponse {
  rows: LeadsByOwnershipLeadRow[];
  total: number;
}

/**
 * One breakdown row: the number of leads owned by one assignee (AC1/AC2), or the "Unassigned"
 * bucket. A lead with several owners counts under each (there is no primary-owner field), so the
 * per-owner counts can sum to more than the distinct lead total when leads are co-assigned.
 */
export interface OwnerCountRow {
  /** null for the "Unassigned" bucket. */
  ownerId: string | null;
  ownerName: string;
  count: number;
}

export interface LeadsByOwnershipSummaryResponse {
  rows: OwnerCountRow[];
  /** Distinct leads in the scoped set. Per-owner counts can exceed this when leads are co-assigned. */
  total: number;
}

/** The values the report's team filter offers (AC3). */
export interface LeadsByOwnershipFilterOptions {
  teams: string[];
}

/** The lead fields the report reads — identity, source and assignees (owners) only. */
export const LEADS_BY_OWNERSHIP_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  source: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

type LeadsByOwnershipLead = Prisma.LeadGetPayload<{
  select: typeof LEADS_BY_OWNERSHIP_SELECT;
}>;

/** Shapes a selected lead into a response row. */
export function toLeadsByOwnershipRow(
  lead: LeadsByOwnershipLead,
): LeadsByOwnershipLeadRow {
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
