import type { SalesFunnelStageRow } from './sales-funnel-response.dto';

/** Pipeline Health (the open pipeline and its coverage) or Closing Leads. */
export const SALES_PIPELINE_VIEWS = ['health', 'closing'] as const;
export type SalesPipelineView = (typeof SALES_PIPELINE_VIEWS)[number];

/** The 3× rule's zones: below 1.5×, 1.5× to 3×, 3× and above. */
export type CoverageStatus = 'critical' | 'risk' | 'on-track';

/** GET /api/reports/sales-pipeline. */
export interface SalesPipelineResponse {
  pipeline: string;
  /** Pipeline by Stage and Stage Metrics: the pipeline's open sales stages, empty ones too. */
  stages: SalesFunnelStageRow[];
  /** Total Open Leads and Weighted Forecast: the stages above, added up. */
  totals: { leads: number; totalValue: string; weightedValue: string };
  /** Leads that became WON in the window — the Dashboard's conversion rule. */
  won: number;
  /** This month's Team Revenue: converted value against the members' monthly goals. */
  revenue: {
    achieved: string;
    /** Null when no member in scope has a monthly goal. */
    target: string | null;
    /** Uncapped; null without a target. */
    percent: number | null;
  };
  /** Open pipeline value ÷ this month's target; null without a target. */
  coverage: { ratio: number | null; status: CoverageStatus | null };
}
