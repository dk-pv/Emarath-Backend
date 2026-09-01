import { Prisma } from '../../generated/prisma/client';
import {
  LEAD_LIST_SELECT,
  LeadListItem,
} from '../../leads/dto/lead-response.dto';

/**
 * One lost lead: the Leads list's own row shape (so the list's column cells render it
 * unchanged) plus the LOST stage colour and the loss instant — `statusChangedAt`, which for
 * a LOST lead is when it became LOST (backfilled to `createdAt` for leads whose status never
 * changed since the column landed).
 */
export type LostLeadRow = LeadListItem & {
  statusColor: string | null;
  lostAt: string;
  /** Why the lead was lost; null renders "No reason recorded". */
  lostReason: string | null;
};

export interface LostLeadsListResponse {
  rows: LostLeadRow[];
  total: number;
}

/** One reason bucket: display label, the drill value, and its count. */
export interface LostReasonCountRow {
  /** "No reason recorded" for the null bucket. */
  reason: string;
  /** What the drill-down sends back as `reason` (`none` for the null bucket). */
  value: string;
  count: number;
}

export interface LostLeadsSummaryResponse {
  rows: LostReasonCountRow[];
  /** Distinct lost leads over the same filters — the denominator. */
  total: number;
}

export interface LostLeadsFilterOptions {
  teams: string[];
}

/** The detailed view's projection: the Leads list row plus the loss instant. */
export const LOST_LIST_SELECT = {
  ...LEAD_LIST_SELECT,
  statusChangedAt: true,
  lostReason: true,
} satisfies Prisma.LeadSelect;

/** The export's projection: the CSV's six columns plus the assignees' names. */
export const LOST_EXPORT_SELECT = {
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
