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
  secondaryPhone: string | null;
  /** Lead.createdAt — the detailed view's "Created Date". */
  createdAt: string;
  /**
   * The most recent assignment's timestamp — Workpex's "Assigned Date". Null when the
   * lead has no assignee; the latest wins, since that is the assignment in force.
   */
  assignedDate: string | null;
  source: string | null;
  status: string;
  /** The status' Stage colour key (KAN-05.1), or null when the catalogue has no match. */
  statusColor: string | null;
  language: string | null;
  callStatus: string | null;
  country: string | null;
  assignedTo: TodayLeadsAgentRef[];
  callAttempts: number;
  whatsappAttempts: number;
  lastContactedAt: string | null;
  /** The lead's soonest outstanding follow-up (earliest incomplete activity), or null. */
  nextFollowUpAt: string | null;
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

/**
 * The lead fields the report reads. Covers the detailed view's columns (RPT-02.2): identity,
 * both phones, the dates, status, language, call status, country, assignees and the
 * engagement counters. The assignment's own `createdAt` is the Assigned Date.
 */
export const TODAY_LEADS_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  createdAt: true,
  source: true,
  status: true,
  language: true,
  callStatus: true,
  country: true,
  callAttempts: true,
  whatsappAttempts: true,
  assignments: {
    select: { createdAt: true, user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

type TodayLead = Prisma.LeadGetPayload<{
  select: typeof TODAY_LEADS_SELECT;
}>;

/**
 * Shapes a selected lead + its computed last-contacted instant and Stage colour into a
 * response row. The Assigned Date is the latest assignment's timestamp — a lead may carry
 * several assignees, and the most recent assignment is the one in force.
 */
export function toTodayLeadRow(
  lead: TodayLead,
  lastContactedAt: Date | null,
  statusColor: string | null = null,
  nextFollowUpAt: Date | null = null,
): TodayLeadRow {
  const assignedDate = lead.assignments.reduce<Date | null>(
    (latest, assignment) =>
      latest === null || assignment.createdAt > latest
        ? assignment.createdAt
        : latest,
    null,
  );

  return {
    id: lead.id,
    name: lead.name,
    firstName: lead.firstName,
    primaryPhone: lead.primaryPhone,
    secondaryPhone: lead.secondaryPhone,
    createdAt: lead.createdAt.toISOString(),
    assignedDate: assignedDate ? assignedDate.toISOString() : null,
    source: lead.source,
    status: lead.status,
    statusColor,
    language: lead.language,
    callStatus: lead.callStatus,
    country: lead.country,
    assignedTo: lead.assignments.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
    callAttempts: lead.callAttempts,
    whatsappAttempts: lead.whatsappAttempts,
    lastContactedAt: lastContactedAt ? lastContactedAt.toISOString() : null,
    nextFollowUpAt: nextFollowUpAt ? nextFollowUpAt.toISOString() : null,
  };
}
