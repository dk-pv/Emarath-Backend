import { ActivityType, Prisma } from '../../generated/prisma/client';
import {
  LEAD_LIST_SELECT,
  LeadListItem,
  toLeadListItem,
} from '../../leads/dto/lead-response.dto';

/**
 * The shape an activity endpoint returns. `title` is derived, never stored
 * (ADR-0027 dec 2): "{Type} with {Customer Name}", computed from the type and
 * the linked lead's name so a lead rename keeps it correct.
 */
export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  leadId: string;
  description: string | null;
  dueAt: string;
  endAt: string | null;
  completedAt: string | null;
  locationId: string | null;
  assigneeIds: string[];
}

/**
 * The exact fields the mapper needs. Declared once so the query and the mapper
 * cannot drift, and so nothing wider is fetched by accident.
 */
export const ACTIVITY_SELECT = {
  id: true,
  type: true,
  leadId: true,
  description: true,
  dueAt: true,
  endAt: true,
  completedAt: true,
  locationId: true,
  assignees: { select: { userId: true } },
} satisfies Prisma.ActivitySelect;

type ActivityRow = Prisma.ActivityGetPayload<{
  select: typeof ACTIVITY_SELECT;
}>;

/** Workpex title label per type ("Call with …", "Meeting with …"). */
const TYPE_LABEL: Record<ActivityType, string> = {
  CALL: 'Call',
  MEETING: 'Meeting',
  TASK: 'Task',
};

export function activityTitle(type: ActivityType, leadName: string): string {
  return `${TYPE_LABEL[type]} with ${leadName}`;
}

export function toActivityItem(
  row: ActivityRow,
  leadName: string,
): ActivityItem {
  return {
    id: row.id,
    type: row.type,
    title: activityTitle(row.type, leadName),
    leadId: row.leadId,
    description: row.description,
    dueAt: row.dueAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    locationId: row.locationId,
    assigneeIds: row.assignees.map((a) => a.userId),
  };
}

/**
 * One worklist row (ACT-02.1): the activity's own fields plus its linked lead's
 * list columns. `assignees` carry names for the Assigned avatars.
 */
export interface ActivityListItem {
  id: string;
  type: ActivityType;
  title: string;
  // Carried so the Edit drawer (ACT-05.1) can prefill without a get-by-id call.
  description: string | null;
  dueAt: string;
  endAt: string | null;
  completedAt: string | null;
  locationId: string | null;
  assignees: { id: string; name: string }[];
  lead: LeadListItem;
}

/** The tab badge counts (ACT-02.2 AC3), returned with every page. */
export interface ActivityBucketCounts {
  overdue: number;
  today: number;
  tomorrow: number;
  completed: number;
  all: number;
}

/** Page + total (CLAUDE.md §8) + per-bucket counts for the tabs. */
export interface ActivityListResponse {
  rows: ActivityListItem[];
  total: number;
  counts: ActivityBucketCounts;
}

/**
 * The lead-joined projection (ADR-0028 §1): each row selects its linked lead's
 * list fields through `LEAD_LIST_SELECT`, so the Activities list can never show a
 * lead shape the Leads list does not. Assignees carry id + name for the avatars.
 */
export const ACTIVITY_LIST_SELECT = {
  id: true,
  type: true,
  description: true,
  dueAt: true,
  endAt: true,
  completedAt: true,
  locationId: true,
  assignees: { select: { user: { select: { id: true, name: true } } } },
  lead: { select: LEAD_LIST_SELECT },
} satisfies Prisma.ActivitySelect;

type ActivityListRow = Prisma.ActivityGetPayload<{
  select: typeof ACTIVITY_LIST_SELECT;
}>;

export function toActivityListItem(row: ActivityListRow): ActivityListItem {
  return {
    id: row.id,
    type: row.type,
    title: activityTitle(row.type, row.lead.name),
    description: row.description,
    dueAt: row.dueAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    locationId: row.locationId,
    assignees: row.assignees.map((a) => a.user),
    lead: toLeadListItem(row.lead),
  };
}
