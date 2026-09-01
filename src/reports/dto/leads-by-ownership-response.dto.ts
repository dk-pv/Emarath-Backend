import { Prisma } from '../../generated/prisma/client';
import { LeadListItem } from '../../leads/dto/lead-response.dto';

/** The bucket label for leads with no assignment (existing project terminology). */
export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * One lead in the detailed view: the Leads list's own row shape (so the list's column cells
 * render it unchanged) plus the resolved Stage colour for the status pill.
 */
export type LeadsByOwnershipLeadRow = LeadListItem & {
  statusColor: string | null;
};

export interface LeadsByOwnershipListResponse {
  rows: LeadsByOwnershipLeadRow[];
  total: number;
}

/**
 * One breakdown row: the number of leads owned by one assignee (AC1/AC2), or the "Unassigned"
 * bucket. A lead with several owners counts under each (there is no primary-owner field), so the
 * per-owner counts can sum to more than the distinct lead total when leads are co-assigned.
 */
export interface OwnerCountRow {
  /** Null for the "Unassigned" bucket. */
  ownerId: string | null;
  ownerName: string;
  /** Total leads assigned to the owner (a co-assigned lead counts for each owner). */
  count: number;
  /** Leads still in the "New" stage. */
  newCount: number;
  /** Leads with an answered call (the Today Leads definition, any time). */
  contactedCount: number;
  /** Leads with no completed activity and no logged call (the No Activity definition). */
  noActivityCount: number;
  /** Leads in the WON stage. */
  convertedCount: number;
  /** Leads in the LOST stage. */
  lostCount: number;
  /** convertedCount / count, as a percentage 0–100. */
  conversionRatio: number;
  /** Emarath has no lead-qualification stage or flag, so this is null (rendered "—"). */
  qualifiedRatio: number | null;
  /** Emarath has no sales-target model, so this is null (rendered "No Target Set"). */
  targetAchievement: number | null;
  /** Σ actualAmount of the owner's leads, AED, as a Decimal string. */
  leadValue: string;
}

export interface LeadsByOwnershipSummaryResponse {
  rows: OwnerCountRow[];
  /** Distinct leads in the scoped set. Per-owner counts can exceed this when leads are co-assigned. */
  total: number;
}

/** The values the report's team filter offers (AC3). */
export interface LeadsByOwnershipFilterOptions {
  teams: string[];
}

/** The lead fields the report reads — identity, source and assignees (owners) only. */
export const LEADS_BY_OWNERSHIP_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  source: true,
  assignments: {
    select: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;
