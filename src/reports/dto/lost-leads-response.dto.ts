import { Prisma } from '../../generated/prisma/client';

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface LostLeadsAgentRef {
  id: string;
  name: string;
}

/**
 * One lost lead in the detailed view (RPT-02.7 AC1). `status` is always "LOST" (the report's
 * definition), shown as a coloured pill using the status's real Stage colour; there is no
 * loss-reason column (none exists in the model or the Workpex reference).
 */
export interface LostLeadRow {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  source: string | null;
  status: string;
  statusColor: string | null;
  assignedTo: LostLeadsAgentRef[];
}

export interface LostLeadsListResponse {
  rows: LostLeadRow[];
  total: number;
}

/**
 * One summary row: lost-lead count per assignee ("Assigned User | No. of Leads"). `agentId` is
 * null for the "Unassigned" bucket and for the synthetic "Total" row (flagged `isTotal`, carrying
 * the distinct-lead count).
 */
export interface LostLeadsSummaryRow {
  agentId: string | null;
  agentName: string;
  count: number;
  isTotal?: boolean;
}

export interface LostLeadsSummaryResponse {
  rows: LostLeadsSummaryRow[];
  /** Distinct lost leads. Per-agent counts can exceed this when a lead has co-assignees. */
  total: number;
}

export interface LostLeadsFilterOptions {
  teams: string[];
}

/** The lead fields the report reads — identity, source, status and assignees. */
export const LOST_LEADS_SELECT = {
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

type LostLead = Prisma.LeadGetPayload<{ select: typeof LOST_LEADS_SELECT }>;

/** Shapes a selected lost lead + its status colour into a response row. */
export function toLostLeadRow(
  lead: LostLead,
  statusColor: string | null,
): LostLeadRow {
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
