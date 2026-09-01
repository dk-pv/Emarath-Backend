import { Prisma } from '../../generated/prisma/client';
import {
  LEAD_LIST_SELECT,
  LeadListItem,
} from '../../leads/dto/lead-response.dto';

/**
 * One converted lead: the Leads list's own row shape (so the list's column cells render it
 * unchanged) plus the resolved Stage colour and the conversion instant — `statusChangedAt`,
 * which for a WON lead is when it became WON (backfilled to `createdAt` for leads whose
 * status never changed since the column landed).
 */
export type ConvertedLeadRow = LeadListItem & {
  statusColor: string | null;
  convertedAt: string;
};

export interface ConvertedLeadsListResponse {
  rows: ConvertedLeadRow[];
  total: number;
}

/** The detailed view's projection: the Leads list row plus the conversion instant. */
export const CONVERTED_LIST_SELECT = {
  ...LEAD_LIST_SELECT,
  statusChangedAt: true,
} satisfies Prisma.LeadSelect;

/** The export's projection: the CSV's six columns plus the assignees' names. */
export const CONVERTED_EXPORT_SELECT = {
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
