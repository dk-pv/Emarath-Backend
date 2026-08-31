import { Prisma } from '../../generated/prisma/client';
import { LeadListItem } from '../../leads/dto/lead-response.dto';

/**
 * One lead in the detailed view (RPT-02.3 AC1/AC3): the Leads list's own row — every
 * column the report shows is a field the list already returns, mapped by the same code —
 * plus `statusColor`, the status's stage colour KEY from the Stage catalogue (KAN-05.1),
 * or null when the status has no catalogue entry. The frontend maps the key to its tokens
 * (never an invented colour).
 */
export type LeadsByStatusLeadRow = LeadListItem & {
  statusColor: string | null;
};

export interface LeadsByStatusListResponse {
  rows: LeadsByStatusLeadRow[];
  total: number;
}

/** One breakdown row: the count of leads at a status, plus its stage colour key (AC1/AC2). */
export interface StatusCountRow {
  status: string;
  count: number;
  color: string | null;
}

export interface LeadsByStatusSummaryResponse {
  rows: StatusCountRow[];
  /** Total leads across all statuses (the scoped set). */
  total: number;
}

/** The values the report's team filter offers (AC3). */
export interface LeadsByStatusFilterOptions {
  teams: string[];
}

/** The lead fields the CSV export reads — identity, source, status and assignees only. */
export const LEADS_BY_STATUS_SELECT = {
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
