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
  /**
   * Orders: the owner's leads in this report (same filters and date window) that have a
   * Logistics order — converted to Logistics, whatever the order's status since. It differs from
   * `convertedCount`, which reads the lead's current stage: a QC-rejected order's lead is no
   * longer WON but still has its order.
   */
  ordersCount: number;
  /** convertedCount / count, as a percentage 0–100. */
  conversionRatio: number;
  /** Emarath has no lead-qualification stage or flag, so this is null (rendered "—"). */
  qualifiedRatio: number | null;
  /**
   * Σ actualAmount of the owner's WON leads in this report ÷ the owner's monthly goal (Target
   * Settings' `monthlyGoalAmount`), as a percentage, uncapped like the dashboard's. The goal is
   * monthly and is not pro-rated to the report's window. Null — "No Target Set" — when the owner
   * has no goal or a zero one, and for the Unassigned bucket.
   */
  targetAchievement: number | null;
  /** Σ actualAmount of the owner's leads, AED, as a Decimal string. */
  leadValue: string;
}

/**
 * One team's subtotal, for each `User.team` among the owners shown; `team` null gathers the owners
 * with no team. Its figures are read over the team's leads — those with at least one assignee on
 * the team — so a lead co-assigned to two members of the team counts once (unlike the owner rows,
 * where it counts for each owner), and a lead shared across two teams counts once in each. Its
 * target is the sum of the monthly goals of the team's active members.
 */
export interface TeamSubtotalRow extends Omit<
  OwnerCountRow,
  'ownerId' | 'ownerName' | 'qualifiedRatio'
> {
  team: string | null;
  /** How many owner rows the subtotal adds up. */
  owners: number;
}

export interface LeadsByOwnershipSummaryResponse {
  rows: OwnerCountRow[];
  /** Distinct leads in the scoped set. Per-owner counts can exceed this when leads are co-assigned. */
  total: number;
  /** Per-team subtotals of `rows` (the Unassigned bucket excluded); empty for a sales agent. */
  teams: TeamSubtotalRow[];
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
