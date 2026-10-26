import { Prisma } from '../generated/prisma/client';
import type { StageProgression } from './sales-funnel-progression';
import {
  IN_SALES_PIPELINE,
  sum,
  toRow,
  type FunnelStage,
} from './sales-funnel-report';
import type {
  CoverageStatus,
  SalesPipelineResponse,
} from './dto/sales-pipeline-response.dto';

/** The 3× rule's zone edges, from the captured legend: Critical <1.5×, Risk 1.5–3×, On track ≥3×. */
export const COVERAGE_RISK_AT = 1.5;
export const COVERAGE_TARGET = 3;

/**
 * Pipeline coverage: the open pipeline's value over this month's revenue target.
 *
 * Emarath has no recorded definition. This is the 3× rule's usual form and is unweighted, like
 * Total Open Leads' Pipeline Value beside it. Workpex's own pipeline is the leads expected to
 * close in the window, a date Emarath doesn't record, so the open pipeline here is the report's
 * (created in the window). ADR-0099 records it as an assumption to confirm. Without a target
 * there is no ratio: null, never a zero that reads as Critical.
 */
export function pipelineCoverage(
  openValue: Prisma.Decimal,
  target: Prisma.Decimal | null,
): { ratio: number | null; status: CoverageStatus | null } {
  if (target === null || target.lte(0)) return { ratio: null, status: null };
  const ratio = openValue
    .div(target)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
  return { ratio, status: coverageStatus(ratio) };
}

export function coverageStatus(ratio: number): CoverageStatus {
  if (ratio < COVERAGE_RISK_AT) return 'critical';
  return ratio < COVERAGE_TARGET ? 'risk' : 'on-track';
}

export interface SalesPipelineInput {
  pipeline: string;
  stages: readonly FunnelStage[];
  /** Leads in each stage now, for the report's filters. */
  current: ReadonlyMap<string, StageProgression>;
  won: number;
  /** This month's Team Revenue. */
  revenue: { achieved: Prisma.Decimal; target: Prisma.Decimal | null };
}

/**
 * Sales Pipeline Analysis' figures. The open pipeline is the pipeline's open "Include In Sales
 * Pipeline" stages, every one listed (empty ones too), with Total Open Leads and Weighted
 * Forecast their sums — the board's rollup, as the Sales Funnel's Live view reads it.
 */
export function buildSalesPipelineReport(
  input: SalesPipelineInput,
): SalesPipelineResponse {
  const stages = input.stages
    .filter((stage) => stage.inclusion === IN_SALES_PIPELINE && !stage.isClosed)
    .map((stage) => toRow(stage, input.current.get(stage.name)));
  const totalValue = sum(stages.map((row) => row.totalValue));
  const { achieved, target } = input.revenue;
  const hasTarget = target !== null && target.gt(0);

  return {
    pipeline: input.pipeline,
    stages,
    totals: {
      leads: stages.reduce((total, row) => total + row.count, 0),
      totalValue,
      weightedValue: sum(stages.map((row) => row.weightedValue)),
    },
    won: input.won,
    revenue: {
      achieved: achieved.toFixed(2),
      target: hasTarget ? target.toFixed(2) : null,
      percent: hasTarget
        ? achieved.div(target).mul(100).toDecimalPlaces(2).toNumber()
        : null,
    },
    coverage: pipelineCoverage(
      new Prisma.Decimal(totalValue),
      hasTarget ? target : null,
    ),
  };
}
