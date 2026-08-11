import { Prisma } from '../../generated/prisma/client';

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface LeadsByStatusAgentRef {
  id: string;
  name: string;
}

/**
 * One lead in the detailed view (RPT-02.3 AC1/AC3). `statusColor` is the lead's status
 * stage colour KEY from the Stage catalogue (KAN-05.1), or null when the status has no
 * catalogue entry — the frontend maps the key to its tokens (never an invented colour).
 */
export interface LeadsByStatusLeadRow {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  source: string | null;
  status: string;
  statusColor: string | null;
  assignedTo: LeadsByStatusAgentRef[];
}

export interface LeadsByStatusListResponse {
  rows: LeadsByStatusLeadRow[];
  total: number;
}

/** One breakdown row: the count of leads at a status, plus its stage colour key (AC1/AC2). */
export interface StatusCountRow {
  status: string;
  count: number;
  color: string | null;
}

export interface LeadsByStatusSummaryResponse {
  rows: StatusCountRow[];
  /** Total leads across all statuses (the scoped set). */
  total: number;
}

/** The values the report's team filter offers (AC3). */
export interface LeadsByStatusFilterOptions {
  teams: string[];
}

/** The lead fields the report reads — identity, source, status and assignees only. */
export const LEADS_BY_STATUS_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  source: true,
  status: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

type LeadsByStatusLead = Prisma.LeadGetPayload<{
  select: typeof LEADS_BY_STATUS_SELECT;
}>;

/** Shapes a selected lead + its status colour into a response row. */
export function toLeadsByStatusRow(
  lead: LeadsByStatusLead,
  statusColor: string | null,
): LeadsByStatusLeadRow {
  return {
    id: lead.id,
    name: lead.name,
    firstName: lead.firstName,
    primaryPhone: lead.primaryPhone,
    source: lead.source,
    status: lead.status,
    statusColor,
    assignedTo: lead.assignments.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
  };
}
