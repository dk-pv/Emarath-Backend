import { Prisma } from '../../generated/prisma/client';

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface TodayLeadsAgentRef {
  id: string;
  name: string;
}

/**
 * One recently-contacted lead in the detailed view (RPT-02.2 AC1/AC3). `callAttempts`/
 * `whatsappAttempts` are the lead's existing engagement counters (LEAD-01.3) — the report's
 * "high engagement" is shown, never scored into an invented metric. `lastContactedAt` is the
 * lead's most recent call instant across all time (ISO), or null when it has no call.
 */
export interface TodayLeadRow {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  source: string | null;
  status: string;
  assignedTo: TodayLeadsAgentRef[];
  callAttempts: number;
  whatsappAttempts: number;
  lastContactedAt: string | null;
}

export interface TodayLeadsListResponse {
  rows: TodayLeadRow[];
  total: number;
}

/** One row of the summary view: a count of recently-contacted leads per assignee. */
export interface TodayLeadsSummaryRow {
  /** null for the "Unassigned" bucket. */
  agentId: string | null;
  agentName: string;
  count: number;
}

export interface TodayLeadsSummaryResponse {
  rows: TodayLeadsSummaryRow[];
  /** Distinct leads. Per-agent counts can exceed this when a lead has co-assignees. */
  total: number;
}

/** The lead fields the report reads — identity, source, status, assignees and the engagement counters. */
export const TODAY_LEADS_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  source: true,
  status: true,
  callAttempts: true,
  whatsappAttempts: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

type TodayLead = Prisma.LeadGetPayload<{
  select: typeof TODAY_LEADS_SELECT;
}>;

/** Shapes a selected lead + its computed last-contacted instant into a response row. */
export function toTodayLeadRow(
  lead: TodayLead,
  lastContactedAt: Date | null,
): TodayLeadRow {
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
    callAttempts: lead.callAttempts,
    whatsappAttempts: lead.whatsappAttempts,
    lastContactedAt: lastContactedAt ? lastContactedAt.toISOString() : null,
  };
}
