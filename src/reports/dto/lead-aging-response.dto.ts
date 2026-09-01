import { Prisma } from '../../generated/prisma/client';

/** The bucket a lead's age falls in, given the caller's thresholds. */
export type LeadHealth = 'healthy' | 'attention' | 'stale';

/** The six metric cards, over the same scoped set the tables show. */
export interface LeadAgingKpis {
  /** Leads tracked — the scoped set (closed-lost excluded unless asked for). */
  totalTracked: number;
  /** Age beyond the amber threshold. */
  stale: number;
  /** Age between the green and amber thresholds. */
  needsAttention: number;
  /** Age within the green threshold. */
  healthy: number;
  /** Mean age in days across the tracked set. */
  avgLeadAgeDays: number;
  /** Leads with no completed activity and no logged call, ever. */
  noActivityEver: number;
}

/** One agent's aging profile. A co-assigned lead counts for each of its assignees. */
export interface LeadAgingAgentRow {
  /** Null for the "Unassigned" bucket. */
  agentId: string | null;
  agentName: string;
  green: number;
  amber: number;
  red: number;
  total: number;
  avgLeadAgeDays: number;
  /** Null when none of the agent's leads carries an assignment date. */
  avgAgeSinceAssignmentDays: number | null;
  avgDaysSinceActivityDays: number;
  noActivityEver: number;
}

export interface LeadAgingSummaryResponse {
  kpis: LeadAgingKpis;
  agents: LeadAgingAgentRow[];
}

/** An assignee reference, exactly the shape the Leads list already exposes. */
export interface LeadAgingAgentRef {
  id: string;
  name: string;
}

/** One row of the Lead Aging Details table. */
export interface LeadAgingLeadRow {
  id: string;
  name: string;
  owner: LeadAgingAgentRef[];
  /** The lead's current stage (its status) and that stage's colour. */
  stage: string;
  stageColor: string | null;
  source: string | null;
  /** Whole days since the lead was created. */
  leadAgeDays: number;
  /** Whole days since the latest assignment; null when unassigned. */
  ageSinceAssignmentDays: number | null;
  /** Whole days since the last engagement — the lead's age when there has never been one. */
  daysSinceNoActivity: number;
  /** The last completed activity or logged call; null means "Never". */
  lastActivityAt: string | null;
  /** Decimal as a string, so the precision survives the wire. */
  amount: string | null;
  health: LeadHealth;
}

export interface LeadAgingListResponse {
  rows: LeadAgingLeadRow[];
  total: number;
}

/** The details view's projection: identity, stage, amount and the assignment dates. */
export const LEAD_AGING_SELECT = {
  id: true,
  name: true,
  status: true,
  source: true,
  actualAmount: true,
  createdAt: true,
  assignments: {
    select: { createdAt: true, user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LeadSelect;

/** The aggregate pass reads the same fields — one projection, one shape to reason about. */
export const LEAD_AGING_AGGREGATE_SELECT = LEAD_AGING_SELECT;
