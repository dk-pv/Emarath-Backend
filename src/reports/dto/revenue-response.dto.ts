import type { LeadListItem } from '../../leads/dto/lead-response.dto';

/** The Data Grid's "Group by" options, in the captured order. */
export const REVENUE_GROUPS = [
  'none',
  'pipeline',
  'agent',
  'role',
  'status',
  'source',
] as const;
export type RevenueGroup = (typeof REVENUE_GROUPS)[number];

/** The Data Grid columns whose header sorts — the nine the Workpex grid shows. */
export const REVENUE_SORTS = [
  'name',
  'pipeline',
  'assigned',
  'status',
  'actualAmount',
  'secondaryPhone',
  'product',
  'language',
  'country',
] as const;
export type RevenueSort = (typeof REVENUE_SORTS)[number];

/** One window's KPI figures. Amounts are AED Decimal strings. */
export interface RevenueFigures {
  /** Σ actualAmount of the deals closed in the window. */
  revenue: string;
  /** Leads that became WON in the window. */
  deals: number;
  /** revenue ÷ deals; null with no deals. */
  avgDealValue: string | null;
  /** Leads created in the window and WON now ÷ leads created in the window; null with none. */
  conversionRate: number | null;
}

export interface RevenueSourceRow {
  /** The lead's source; "No Source" for none. */
  source: string;
  revenue: string;
  deals: number;
  /** The conversion rule on this source's leads; null when none was created in the window. */
  conversionRate: number | null;
  /** The comparison window's revenue; null when no comparison window was asked for. */
  priorRevenue: string | null;
  /** Revenue's change on the comparison window, %; null without prior revenue. */
  change: number | null;
}

export interface RevenuePipelineRow {
  pipeline: string;
  revenue: string;
  deals: number;
  /** Leads that became LOST in the window. */
  lost: number;
  /** deals ÷ (deals + lost); null with neither. */
  winRate: number | null;
}

/** GET /api/reports/revenue. */
export interface RevenueOverviewResponse {
  current: RevenueFigures;
  /** Null when no comparison window was asked for. */
  prior: RevenueFigures | null;
  /** Each figure's change on the comparison window, %; null where there is nothing to compare. */
  change: {
    revenue: number | null;
    deals: number | null;
    avgDealValue: number | null;
    conversionRate: number | null;
  };
  target: {
    /** Σ the members' monthly goals; null when none is set. */
    monthly: string | null;
    /** The whole calendar months the window spans, as the client counted them; null otherwise. */
    months: number | null;
    /** monthly × months; null without either. */
    period: string | null;
    /** revenue ÷ period, uncapped; null without a period target. */
    percent: number | null;
  };
  /** One entry per requested bucket, in order. */
  trend: { from: string; to: string; revenue: string; deals: number }[];
  /** Every source with a deal in the window, highest revenue first. */
  sources: RevenueSourceRow[];
  /** Every pipeline with a deal won or lost in the window, highest revenue first. */
  pipelines: RevenuePipelineRow[];
}

/** One deal: the Leads list's own row plus its stage colour, conversion instant and group. */
export type RevenueDealRow = LeadListItem & {
  statusColor: string | null;
  convertedAt: string;
  /** Its group's key under the requested grouping; null with no grouping. */
  groupKey: string | null;
};

/** GET /api/reports/revenue/deals. */
export interface RevenueDealsResponse {
  rows: RevenueDealRow[];
  total: number;
  /** The groups on this page, in order, each with its count across every page. */
  groups: { key: string; label: string; count: number }[];
  /** True when the window holds more deals than one read sorts (`MAX_DEALS`). */
  truncated: boolean;
}
