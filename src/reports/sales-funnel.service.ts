import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { buildLeadWhere, type LeadWhereQuery } from '../leads/lead-where';
import { StagesService } from '../stages/stages.service';
import { SalesFunnelQueryDto } from './dto/sales-funnel-query.dto';
import { SalesFunnelResponse } from './dto/sales-funnel-response.dto';
import {
  addProgression,
  snapshotField,
  type StageProgression,
  type StageRename,
} from './sales-funnel-progression';
import { buildSalesFunnelReport } from './sales-funnel-report';
import { salesFunnelPdf } from './sales-funnel-pdf';

/** The board's where inputs plus the report's own switches; the DTO satisfies it. */
export type SalesFunnelQuery = LeadWhereQuery &
  Pick<SalesFunnelQueryDto, 'view' | 'includeLost' | 'subtitle'>;

/** The board the Kanban rollup defaults to. */
const DEFAULT_PIPELINE = 'Lead Pipeline';

/** Leads read per round trip for the Full view, each batch's moves in one more query. */
const BATCH_SIZE = 1000;

/**
 * The Sales Funnel Report (Analytics, ADR-0099). Its leads are exactly the Kanban board's for
 * the same filters — one `buildLeadWhere`, so the role scope, pipeline access and soft delete
 * come along — and its arithmetic is `buildSalesFunnelReport`, which the PDF export reuses.
 */
@Injectable()
export class SalesFunnelReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly stages: StagesService,
  ) {}

  async report(query: SalesFunnelQuery): Promise<SalesFunnelResponse> {
    const user = await this.currentUser.resolve();
    const pipeline = query.pipeline || DEFAULT_PIPELINE;
    const view = query.view ?? 'full';
    const where = buildLeadWhere(user, { ...query, pipeline });

    const [stages, grouped, overall] = await Promise.all([
      this.stages.list(pipeline),
      this.prisma.lead.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { actualAmount: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.lead.count({ where }),
    ]);
    const current = new Map<string, StageProgression>(
      grouped.map((row) => [
        row.status,
        {
          count: row._count,
          value: row._sum.actualAmount ?? new Prisma.Decimal(0),
        },
      ]),
    );

    return buildSalesFunnelReport({
      view,
      pipeline,
      includeLost: query.includeLost ?? true,
      stages,
      counts:
        view === 'full' ? await this.progression(where, pipeline) : current,
      current: new Map([...current].map(([stage, row]) => [stage, row.count])),
      overall,
    });
  }

  /** The report as a PDF download; resolves to its Stage Metrics row count for the audit. */
  async exportPdf(query: SalesFunnelQuery, res: Response): Promise<number> {
    const report = await this.report(query);
    const file = salesFunnelPdf(report, {
      subtitle: query.subtitle || report.pipeline,
      includeLost: query.includeLost ?? true,
      generatedAt: new Date(),
    });
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="sales-funnel-${fileStamp(new Date())}.pdf"`,
      )
      .end(file);
    return report.table.length;
  }

  /**
   * Every stage each scoped lead has been in, rolled up per stage. The leads are read in id
   * order a batch at a time, with that batch's status moves, so memory stays flat however wide
   * the window.
   */
  private async progression(
    where: Prisma.LeadWhereInput,
    pipeline: string,
  ): Promise<Map<string, StageProgression>> {
    const renames = await this.renames(pipeline);
    const totals = new Map<string, StageProgression>();
    let cursor: string | undefined;

    for (;;) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: { id: true, status: true, actualAmount: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (leads.length === 0) break;

      const moves = await this.prisma.auditEvent.findMany({
        where: {
          entityType: 'LEAD',
          entityId: { in: leads.map((lead) => lead.id) },
          action: { in: ['STATUS_CHANGED', 'CONVERTED'] },
        },
        select: { entityId: true, createdAt: true, before: true, after: true },
      });
      addProgression(
        totals,
        leads,
        moves.map((move) => ({
          leadId: move.entityId,
          createdAt: move.createdAt,
          from: snapshotField(move.before, 'status'),
          to: snapshotField(move.after, 'status'),
        })),
        renames,
      );

      if (leads.length < BATCH_SIZE) break;
      cursor = leads[leads.length - 1].id;
    }
    return totals;
  }

  /** The pipeline's stage renames, oldest first (catalogue events, `metadata.pipeline`). */
  private async renames(pipeline: string): Promise<StageRename[]> {
    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityType: 'STAGE',
        action: 'RENAMED',
        metadata: { path: ['pipeline'], equals: pipeline },
      },
      select: { createdAt: true, before: true, after: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return events.flatMap((event) => {
      const from = snapshotField(event.before, 'name');
      const to = snapshotField(event.after, 'name');
      return from && to ? [{ at: event.createdAt, from, to }] : [];
    });
  }
}

/** `YYYYMMDD-HHmmss` (UTC), the other exports' file-name stamp. */
function fileStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}
