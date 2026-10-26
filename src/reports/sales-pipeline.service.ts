import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { buildLeadWhere, type LeadWhereQuery } from '../leads/lead-where';
import { StagesService } from '../stages/stages.service';
import {
  convertedInPeriodWhere,
  targetMembersWhere,
} from '../dashboard/team-revenue.service';
import { SalesPipelineQueryDto } from './dto/sales-pipeline-query.dto';
import { SalesPipelineResponse } from './dto/sales-pipeline-response.dto';
import type { StageProgression } from './sales-funnel-progression';
import { buildSalesPipelineReport } from './sales-pipeline-report';
import { salesPipelinePdf } from './sales-pipeline-pdf';

/** The board the Kanban rollup defaults to. */
const DEFAULT_PIPELINE = 'Lead Pipeline';

/** The board's where inputs plus the report's own; the DTO satisfies it. */
export type SalesPipelineQuery = LeadWhereQuery &
  Pick<SalesPipelineQueryDto, 'monthFrom' | 'monthTo' | 'view' | 'subtitle'>;

/**
 * Sales Pipeline Analysis (Analytics, ADR-0099). Each figure keeps its own scope:
 *
 * - the open pipeline (Total Open Leads, Weighted Forecast, Pipeline by Stage, Stage Metrics)
 *   is the Kanban board's own leads for the filters — created in the window;
 * - Won is the leads that **became** WON in the window, the Dashboard's conversion rule
 *   (`status` WON, `statusChangedAt` in the period), under the same pipeline/agent/source;
 * - revenue, target and coverage are this calendar month's, the Dashboard's Team Revenue rules
 *   (converted value; the scoped members' monthly goals), whatever the toolbar's window.
 *
 * Five aggregates in one round trip; no lead is loaded into memory.
 */
@Injectable()
export class SalesPipelineReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly stages: StagesService,
  ) {}

  async report(query: SalesPipelineQuery): Promise<SalesPipelineResponse> {
    const user = await this.currentUser.resolve();
    const pipeline = query.pipeline || DEFAULT_PIPELINE;
    const where = buildLeadWhere(user, { ...query, pipeline });
    const sameFilters = buildLeadWhere(user, {
      ...query,
      pipeline,
      createdFrom: undefined,
      createdTo: undefined,
    });
    const changed: Prisma.DateTimeFilter = {};
    if (query.createdFrom) changed.gte = new Date(query.createdFrom);
    if (query.createdTo) changed.lt = new Date(query.createdTo);
    const month = { from: query.monthFrom, to: query.monthTo };

    const [stages, grouped, won, converted, targets] = await Promise.all([
      this.stages.list(pipeline),
      this.prisma.lead.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { actualAmount: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.lead.count({
        where: {
          AND: [
            sameFilters,
            {
              status: 'WON',
              ...(changed.gte || changed.lt
                ? { statusChangedAt: changed }
                : {}),
            },
          ],
        },
      }),
      this.prisma.lead.aggregate({
        where: convertedInPeriodWhere(user, month),
        _sum: { actualAmount: true },
      }),
      this.prisma.user.aggregate({
        where: targetMembersWhere(user),
        _sum: { monthlyGoalAmount: true },
      }),
    ]);

    return buildSalesPipelineReport({
      pipeline,
      stages,
      current: new Map<string, StageProgression>(
        grouped.map((row) => [
          row.status,
          {
            count: row._count,
            value: row._sum.actualAmount ?? new Prisma.Decimal(0),
          },
        ]),
      ),
      won,
      revenue: {
        achieved: converted._sum.actualAmount ?? new Prisma.Decimal(0),
        target: targets._sum.monthlyGoalAmount ?? null,
      },
    });
  }

  /** The report as a PDF download; resolves to its Stage Metrics row count for the audit. */
  async exportPdf(query: SalesPipelineQuery, res: Response): Promise<number> {
    const report = await this.report(query);
    const file = salesPipelinePdf(report, {
      subtitle: query.subtitle || report.pipeline,
      view: query.view ?? 'health',
      generatedAt: new Date(),
    });
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="sales-pipeline-${fileStamp(new Date())}.pdf"`,
      )
      .end(file);
    return report.stages.length;
  }
}

/** `YYYYMMDD-HHmmss` (UTC), the other exports' file-name stamp. */
function fileStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}
