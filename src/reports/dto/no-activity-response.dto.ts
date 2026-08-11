import { Prisma } from '../../generated/prisma/client';

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface NoActivityAgentRef {
  id: string;
  name: string;
}

/**
 * One affected lead in the detailed view (RPT-02.1 AC1/AC3). `lastActivityAt` is the lead's
 * most recent completed-activity instant across all time (ISO), or null when it has never
 * been engaged — the report never fabricates a date.
 */
export interface NoActivityLeadRow {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  source: string | null;
  status: string;
  assignedTo: NoActivityAgentRef[];
  lastActivityAt: string | null;
}

export interface NoActivityListResponse {
  rows: NoActivityLeadRow[];
  total: number;
}

/** One row of the summary view: a count of affected leads per assignee (Workpex summary). */
export interface NoActivitySummaryRow {
  /** null for the "Unassigned" bucket. */
  agentId: string | null;
  agentName: string;
  count: number;
}

export interface NoActivitySummaryResponse {
  rows: NoActivitySummaryRow[];
  /** Distinct affected leads. Per-agent counts can exceed this when a lead has co-assignees. */
  total: number;
}

/** The lead fields the report reads — identity, source, status and assignees only. */
export const NO_ACTIVITY_SELECT = {
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

type NoActivityLead = Prisma.LeadGetPayload<{
  select: typeof NO_ACTIVITY_SELECT;
}>;

/** Shapes a selected lead + its computed last-activity instant into a response row. */
export function toNoActivityRow(
  lead: NoActivityLead,
  lastActivityAt: Date | null,
): NoActivityLeadRow {
  return {
    id: lead.id,
    name: lead.name,
    firstName: lead.firstName,
    primaryPhone: lead.primaryPhone,
    source: lead.source,
    status: lead.status,
    assignedTo: lead.assignments.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
  };
}
