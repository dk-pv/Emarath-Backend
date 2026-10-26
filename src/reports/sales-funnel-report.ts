import { Prisma } from '../generated/prisma/client';
import type { StageProgression } from './sales-funnel-progression';
import type {
  SalesFunnelResponse,
  SalesFunnelStageRow,
  SalesFunnelView,
} from './dto/sales-funnel-response.dto';

/** The stage setting that puts a stage on the sales funnel (the Sales Pipeline wizard). */
export const IN_SALES_PIPELINE = 'INCLUDE_IN_SALES_PIPELINE';

/** The catalogue fields the report reads, in the pipeline's stage order. */
export interface FunnelStage {
  id: string;
  name: string;
  color: string;
  isClosed: boolean;
  outcome: string | null;
  inclusion: string;
  probability: number;
}

export interface SalesFunnelInput {
  view: SalesFunnelView;
  pipeline: string;
  includeLost: boolean;
  stages: readonly FunnelStage[];
  /** Per stage: the view's leads — ever been there (Full) or there now (Live). */
  counts: ReadonlyMap<string, StageProgression>;
  /** Leads in each stage now, for the conversion rate. */
  current: ReadonlyMap<string, number>;
  /** Every lead in scope. */
  overall: number;
}

/**
 * The Sales Funnel Report, both views, traced from Workpex's Oct 2026 captures:
 *
 * - **Stage Metrics** lists the pipeline's open stages: all of them in Full (empty ones too),
 *   the ones holding leads in Live (15 rows there against 17 in Full).
 * - **Funnel Movement** adds the closed stages, in the pipeline's order: every stage in Full,
 *   the ones holding leads in Live — WON and the stages after it included (the Oct Live funnel
 *   is scaled to a ~2,420-lead stage, far past its open ones), LOST only while "Include Lost
 *   Stage" is ticked.
 * - **Total Leads** is the leads on the table: in Full every lead in scope (8,359 = 4,716 open +
 *   3,643 closed), in Live the open ones. **Total Value** and **Weighted Forecast** add up the
 *   table — Full's 870,494.00 is exactly its 17 rows.
 * - **Conversion Rate** is leads now in a WON stage over every lead in scope, the same in both
 *   views (31.3 % in each).
 */
export function buildSalesFunnelReport(
  input: SalesFunnelInput,
): SalesFunnelResponse {
  const { view, includeLost, counts } = input;
  const onFunnel = input.stages.filter(
    (stage) => stage.inclusion === IN_SALES_PIPELINE,
  );
  const isLost = (stage: FunnelStage) =>
    stage.isClosed && stage.outcome === 'LOST';
  const rows = onFunnel.map((stage) => toRow(stage, counts.get(stage.name)));

  const table = rows.filter(
    (row) => !row.stage.isClosed && (view === 'full' || row.count > 0),
  );
  const funnel = rows.filter(
    (row, index) =>
      (includeLost || !isLost(onFunnel[index])) &&
      (view === 'full' || row.count > 0),
  );

  const won = input.stages
    .filter((stage) => stage.isClosed && stage.outcome === 'WON')
    .reduce((sum, stage) => sum + (input.current.get(stage.name) ?? 0), 0);

  return {
    view,
    pipeline: input.pipeline,
    funnel,
    table,
    totals: {
      leads:
        view === 'full'
          ? input.overall
          : table.reduce((sum, row) => sum + row.count, 0),
      totalValue: sum(table.map((row) => row.totalValue)),
      weightedValue: sum(table.map((row) => row.weightedValue)),
    },
    conversionRate: input.overall > 0 ? (won / input.overall) * 100 : null,
  };
}

/** One stage with its leads and value, weighted by the stage probability to the fils. */
export function toRow(
  stage: FunnelStage,
  progression: StageProgression | undefined,
): SalesFunnelStageRow {
  const value = progression?.value ?? new Prisma.Decimal(0);
  return {
    stage: {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      probability: stage.probability,
      isClosed: stage.isClosed,
      outcome: stage.outcome,
    },
    count: progression?.count ?? 0,
    totalValue: value.toFixed(2),
    weightedValue: value
      .mul(stage.probability)
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2),
  };
}

export function sum(values: readonly string[]): string {
  return values
    .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
    .toFixed(2);
}
