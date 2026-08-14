import { ActivityType, Prisma } from '../../generated/prisma/client';

/** An assignee reference, exactly the shape the Activities list already exposes. */
export interface OverdueFollowUpsAgentRef {
  id: string;
  name: string;
}

/**
 * One overdue follow-up in the detailed view (RPT-03.2). No Workpex detailed capture exists, so
 * the columns follow the Activities-list + RPT-02.x conventions: the linked customer, the
 * follow-up type, its due date (the field that makes it overdue) and the assignees.
 */
export interface OverdueFollowUpRow {
  id: string;
  type: ActivityType;
  customerName: string;
  primaryPhone: string;
  dueAt: string;
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
   * Distinct overdue follow-ups. A per-agent count can exceed this when a follow-up is
   * co-assigned (each assignee is counted once), so the two are reported separately.
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
  lead: { select: { name: true, primaryPhone: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.ActivitySelect;

type OverdueFollowUp = Prisma.ActivityGetPayload<{
  select: typeof OVERDUE_FOLLOW_UPS_SELECT;
}>;

/** Shapes a selected overdue follow-up into a response row. */
export function toOverdueFollowUpRow(
  activity: OverdueFollowUp,
): OverdueFollowUpRow {
  return {
    id: activity.id,
    type: activity.type,
    customerName: activity.lead.name,
    primaryPhone: activity.lead.primaryPhone,
    dueAt: activity.dueAt.toISOString(),
    assignedTo: activity.assignees.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
  };
}
