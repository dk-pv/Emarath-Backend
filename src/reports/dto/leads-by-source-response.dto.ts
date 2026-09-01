import { Prisma } from '../../generated/prisma/client';
import { LeadListItem } from '../../leads/dto/lead-response.dto';

/** The bucket label for leads whose `source` is null or blank (AC1 accounts for every lead). */
export const NO_SOURCE_LABEL = 'No Source';

/**
 * One lead in the detailed view: the Leads list's own row shape (so the list's column cells
 * render it unchanged) plus the resolved Stage colour for the status pill.
 */
export type LeadsBySourceLeadRow = LeadListItem & {
  statusColor: string | null;
};

export interface LeadsBySourceListResponse {
  rows: LeadsBySourceLeadRow[];
  total: number;
}

/**
 * One breakdown row: the count of leads at a source (AC1/AC2). `source` is the acquisition
 * channel, or "No Source" for the null/blank bucket. Share is derived from `count`/`total` by
 * the client, so the row carries no rounded percentage.
 */
export interface SourceCountRow {
  source: string;
  count: number;
  /** The bucket's share of the filtered total, as a percentage 0–100 (AC2). */
  share: number;
  /** Share of the bucket that has converted (status WON), as a percentage 0–100. */
  conversionRate: number;
}

export interface LeadsBySourceSummaryResponse {
  rows: SourceCountRow[];
  /** Total leads across all sources (the scoped set) — the denominator for "share". */
  total: number;
}

/** The values the report's team filter offers (AC3). */
export interface LeadsBySourceFilterOptions {
  teams: string[];
}

/** The export's projection: the CSV's five columns plus the assignees' names. */
export const LEADS_BY_SOURCE_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  source: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;
