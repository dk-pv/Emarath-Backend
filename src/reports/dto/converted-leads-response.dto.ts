import { Prisma } from '../../generated/prisma/client';

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface ConvertedLeadsAgentRef {
  id: string;
  name: string;
}

/**
 * One converted lead in the detailed view (RPT-02.6 AC1/AC2). `actualAmount` is the lead's
 * confirmed value — the report's "converted amount" — serialized as a string to preserve the
 * Decimal exactly (the same convention the Leads list uses); null when the lead has no amount.
 */
export interface ConvertedLeadRow {
  id: string;
  name: string;
  firstName: string | null;
  primaryPhone: string;
  source: string | null;
  assignedTo: ConvertedLeadsAgentRef[];
  actualAmount: string | null;
}

export interface ConvertedLeadsListResponse {
  rows: ConvertedLeadRow[];
  total: number;
}

/**
 * One summary row: converted-lead count and total converted amount (Σ actualAmount, AED string)
 * per assignee. `agentId` is null for the "Unassigned" bucket and for the synthetic "Total" row,
 * which is flagged `isTotal` and carries the distinct-lead count and grand total amount.
 */
export interface ConvertedLeadsSummaryRow {
  agentId: string | null;
  agentName: string;
  count: number;
  amount: string;
  isTotal?: boolean;
}

export interface ConvertedLeadsSummaryResponse {
  rows: ConvertedLeadsSummaryRow[];
  /** Distinct converted leads. Per-agent counts can exceed this when a lead has co-assignees. */
  total: number;
}

/** The lead fields the detailed view reads — identity, source, assignees and the converted amount. */
export const CONVERTED_LEADS_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  source: true,
  actualAmount: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

/** The minimal projection the summary aggregates over — the amount plus assignee ids only. */
export const CONVERTED_SUMMARY_SELECT = {
  id: true,
  actualAmount: true,
  assignments: { select: { userId: true } },
} satisfies Prisma.LeadSelect;

type ConvertedLead = Prisma.LeadGetPayload<{
  select: typeof CONVERTED_LEADS_SELECT;
}>;

/** Serializes a nullable Decimal to the string the Leads list uses (null stays null). */
export function amountToString(value: Prisma.Decimal | null): string | null {
  return value?.toString() ?? null;
}

/** Shapes a selected converted lead into a response row. */
export function toConvertedLeadRow(lead: ConvertedLead): ConvertedLeadRow {
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
    actualAmount: amountToString(lead.actualAmount),
  };
}
