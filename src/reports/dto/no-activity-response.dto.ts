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
  secondaryPhone: string | null;
  /** Decimal(12,2) as a string so the precision survives the wire. */
  actualAmount: string | null;
  pipeline: string;
  status: string;
  /** The status' Stage colour key (KAN-05.1), or null when the catalogue has no match. */
  statusColor: string | null;
  assignedTo: NoActivityAgentRef[];
  source: string | null;
  category: string | null;
  country: string | null;
  street: string | null;
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

/**
 * The lead fields the report reads. Covers the detailed view's columns (RPT-02.1): identity,
 * both phones, amount, pipeline, status, assignees, source and the address fields.
 */
export const NO_ACTIVITY_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  actualAmount: true,
  pipeline: true,
  status: true,
  category: true,
  country: true,
  street: true,
  source: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

type NoActivityLead = Prisma.LeadGetPayload<{
  select: typeof NO_ACTIVITY_SELECT;
}>;

/**
 * Shapes a selected lead + its computed last-activity instant and Stage colour into a
 * response row. `actualAmount` is stringified rather than converted to a number so the
 * Decimal's precision is preserved, exactly as the Converted Leads report does.
 */
export function toNoActivityRow(
  lead: NoActivityLead,
  lastActivityAt: Date | null,
  statusColor: string | null,
): NoActivityLeadRow {
  return {
    id: lead.id,
    name: lead.name,
    firstName: lead.firstName,
    primaryPhone: lead.primaryPhone,
    secondaryPhone: lead.secondaryPhone,
    actualAmount: lead.actualAmount ? lead.actualAmount.toString() : null,
    pipeline: lead.pipeline,
    status: lead.status,
    statusColor,
    assignedTo: lead.assignments.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
    source: lead.source,
    category: lead.category,
    country: lead.country,
    street: lead.street,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
  };
}
