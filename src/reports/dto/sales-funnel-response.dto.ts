/** Full Funnel View (every stage a lead has been in) or Live Funnel View (where it is now). */
export const SALES_FUNNEL_VIEWS = ['full', 'live'] as const;
export type SalesFunnelView = (typeof SALES_FUNNEL_VIEWS)[number];

/** One stage of the funnel or the Stage Metrics table. */
export interface SalesFunnelStageRow {
  stage: {
    id: string;
    name: string;
    /** The stage palette key (`stage.constants`); the client maps it to a colour. */
    color: string;
    probability: number;
    isClosed: boolean;
    outcome: string | null;
  };
  count: number;
  /** Summed `actualAmount`, as a string — Decimal precision must survive the wire. */
  totalValue: string;
  /** `totalValue × probability`, to the fils. */
  weightedValue: string;
}

/** GET /api/reports/sales-funnel. */
export interface SalesFunnelResponse {
  view: SalesFunnelView;
  pipeline: string;
  /** The Funnel Movement drawing, in stage order. */
  funnel: SalesFunnelStageRow[];
  /** The Stage Metrics rows: the pipeline's open stages. */
  table: SalesFunnelStageRow[];
  /** The KPI cards' Total Leads, Total Value and Weighted Forecast. */
  totals: { leads: number; totalValue: string; weightedValue: string };
  /** Leads now in a WON stage as a percentage of every lead in scope; null with none. */
  conversionRate: number | null;
}
