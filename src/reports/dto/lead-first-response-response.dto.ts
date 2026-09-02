import { Prisma } from '../../generated/prisma/client';

/** The five metric cards, over the same scoped set the records show. */
export interface LeadFirstResponseKpis {
  /** Leads in the selected period. */
  totalLeads: number;
  /** Leads someone has engaged (a completed activity or a logged call). */
  contacted: number;
  /** `contacted / totalLeads`, as a percentage 0–100. */
  contactRate: number;
  /** Mean minutes from creation to first engagement, across contacted leads; null when none. */
  avgFirstResponseMinutes: number | null;
  untouched: number;
  /** `untouched / totalLeads`, as a percentage 0–100. */
  untouchedRate: number;
  /** Contacted leads whose first response landed past the late bound. */
  respondedLate: number;
  /** `respondedLate / contacted`, as a percentage 0–100. */
  lateRate: number;
}

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface LeadFirstResponseAgentRef {
  id: string;
  name: string;
}

/** One row of the Lead Records table. */
export interface LeadFirstResponseRow {
  id: string;
  name: string;
  assignedTo: LeadFirstResponseAgentRef[];
  source: string | null;
  createdAt: string;
  /** The first engagement's instant; null means the lead is untouched. */
  firstActivityAt: string | null;
  /** What that first engagement was: an activity kind, or `CALL` for a logged call. */
  activityType: string | null;
  /** Minutes from creation to that first engagement; null when untouched. */
  firstResponseMinutes: number | null;
  /** The soonest outstanding follow-up, or null. */
  followUpAt: string | null;
}

export interface LeadFirstResponseListResponse {
  rows: LeadFirstResponseRow[];
  total: number;
}

export interface LeadFirstResponseSummaryResponse {
  kpis: LeadFirstResponseKpis;
  /** The records tabs' counts, over the same filters minus the tab itself. */
  tabs: { all: number; contacted: number; untouched: number };
}

/** The records projection: identity, source, dates and the assignees. */
export const FIRST_RESPONSE_SELECT = {
  id: true,
  name: true,
  source: true,
  createdAt: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;
