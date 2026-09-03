import { ActivityType, Prisma } from '../../generated/prisma/client';

/** An assignee reference, exactly the shape the Activities list already exposes. */
export interface OverdueFollowUpsAgentRef {
  id: string;
  name: string;
}

/**
 * One overdue follow-up in the detailed view (RPT-03.2), carrying the reference's six columns:
 * Lead Name, Lead Status, Assigned User, Follow up Type, Date and Time, Notes. `leadId` is what
 * makes the name a link to that customer's details; `statusColor` is the lead status's real
 * Stage colour, so the badge can never invent a hue the pipeline does not use.
 */
export interface OverdueFollowUpRow {
  id: string;
  type: ActivityType;
  leadId: string;
  customerName: string;
  primaryPhone: string;
  status: string;
  statusColor: string | null;
  dueAt: string;
  /** The follow-up's own description — the reference's Notes column. */
  notes: string | null;
  assignedTo: OverdueFollowUpsAgentRef[];
}

export interface OverdueFollowUpsListResponse {
  rows: OverdueFollowUpRow[];
  total: number;
}

/**
 * One summary row: overdue-follow-up count per assignee ("Assigned User | Overdue Count", the
 * Workpex reference). `agentId` is null only for the defensive "Unassigned" bucket. There is no
 * "Total" row — the Workpex reference shows none.
 */
export interface OverdueFollowUpsSummaryRow {
  agentId: string | null;
  agentName: string;
  count: number;
}

export interface OverdueFollowUpsSummaryResponse {
  rows: OverdueFollowUpsSummaryRow[];
  /**
   * How many assignee rows match — the `ListResult` total the "Rows per page" control pages on,
   * not a follow-up count. The per-agent counts can sum higher than the distinct number of
   * overdue follow-ups, because a co-assigned one is counted once for each of its assignees.
   */
  total: number;
}

export interface OverdueFollowUpsFilterOptions {
  teams: string[];
}

/** The activity fields the report reads — type, due date, the linked customer and assignees. */
export const OVERDUE_FOLLOW_UPS_SELECT = {
  id: true,
  type: true,
  dueAt: true,
  description: true,
  lead: { select: { id: true, name: true, primaryPhone: true, status: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.ActivitySelect;

type OverdueFollowUp = Prisma.ActivityGetPayload<{
  select: typeof OVERDUE_FOLLOW_UPS_SELECT;
}>;

/** Shapes a selected overdue follow-up into a response row. */
export function toOverdueFollowUpRow(
  activity: OverdueFollowUp,
  statusColor: string | null = null,
): OverdueFollowUpRow {
  return {
    id: activity.id,
    type: activity.type,
    leadId: activity.lead.id,
    customerName: activity.lead.name,
    primaryPhone: activity.lead.primaryPhone,
    status: activity.lead.status,
    statusColor,
    dueAt: activity.dueAt.toISOString(),
    notes: activity.description,
    assignedTo: activity.assignees.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
  };
}
