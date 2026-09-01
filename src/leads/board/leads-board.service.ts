import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { StagesService } from '../../stages/stages.service';
import { OUT_OF_SCOPE_REASON } from '../bulk/dto/bulk-actions.dto';
import { LEAD_LIST_SELECT, toLeadListItem } from '../dto/lead-response.dto';
import { leadScopeWhere } from '../lead-scope';
import { buildLeadWhere, LeadWhereQuery } from '../lead-where';
import { BoardStageSummary, LeadBoardResponse } from './dto/board-query.dto';
import { MoveLeadStageDto, MoveLeadStageResponse } from './dto/move-stage.dto';
import { LOST_STATUS } from '../lead-status.constants';

/**
 * Kanban board data (KAN-02.1): leads grouped by stage for the selected pipeline,
 * each column carrying its lead count and combined value; plus the stage change a
 * card drag performs (KAN-04.1).
 *
 * The grouping reuses the one scoped query builder (`buildLeadWhere`) every lead
 * read shares, so the board can never see a lead the list would hide (AC3) — the
 * role scope and the soft-delete predicate come along for free. A `pipeline`
 * filter narrows to the selected board (AC1/AC4). Two aggregates run together: a
 * `groupBy(status)` for the per-column count + value, and one `aggregate` for the
 * pipeline-wide totals — both index-backed (`@@index([status, deletedAt])` /
 * `@@index([pipeline, deletedAt])`) so they stay acceptable at 15k+ rows (AC5).
 *
 * "Value" is `actualAmount` — the same figure the list's Actual Amount column and
 * the Workpex card show (0 until an order is booked, which is why New columns read
 * low). The stage catalogue, order and colours are the frontend's (status config,
 * ADR-0005) until FND-04.2 lands a stage table; this API returns only the stages
 * that carry leads, and the board overlays the full ordered set.
 */
@Injectable()
export class LeadsBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly stages: StagesService,
  ) {}

  async board(query: LeadWhereQuery): Promise<LeadBoardResponse> {
    const user = await this.currentUser.resolve();
    // The list query is optional on `pipeline`; the board always groups one board,
    // so default it here (the DTO already trimmed it). The whole query then flows
    // through the one shared builder, so the board's search and filters narrow the
    // rollup exactly as they narrow the list (KAN-07.1 AC1/AC5) — a groupBy over
    // `where status IN (...)` returns only the matching stages, an empty search or
    // filter leaves the pipeline board unchanged.
    const pipeline = query.pipeline || 'Lead Pipeline';
    const where = buildLeadWhere(user, { ...query, pipeline });

    // Two independent read aggregates — `Promise.all`, not a snapshot transaction:
    // a board rollup only needs live counts, and the exact groupBy result types
    // survive `Promise.all` (the array `$transaction` overload widens them).
    const [stages, overall] = await Promise.all([
      this.stageSummaries(where),
      this.prisma.lead.aggregate({
        where,
        _count: true,
        _sum: { actualAmount: true },
      }),
    ]);

    return {
      pipeline,
      // A stable, deterministic order; the board reorders by its stage config.
      stages: stages.sort((a, b) => a.stage.localeCompare(b.stage)),
      totals: {
        count: overall._count,
        totalValue: overall._sum.actualAmount?.toString() ?? '0',
      },
    };
  }

  /**
   * Moves one lead to a new stage (KAN-04.1) — the drag-and-drop counterpart to
   * the drawer's manual Lead Status edit, writing the same `status` field so the
   * change shows everywhere the status does (AC1/AC2). The target stage is already
   * validated against the shared catalogue by the DTO (AC4).
   *
   * The move is scoped exactly like every other lead mutation: the lead is looked
   * up through `leadScopeWhere` first, so a caller can only move a lead they can
   * see — anything else is a 404, never a cross-scope write (AC5). Only the source
   * and target columns are recounted, from the same scoped builder the board GET
   * uses, so the returned deltas can never disagree with a board reload (AC3).
   */
  async moveStage(
    id: string,
    dto: MoveLeadStageDto,
  ): Promise<MoveLeadStageResponse> {
    const user = await this.currentUser.resolve();

    const current = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { status: true, pipeline: true },
    });
    if (!current) throw new NotFoundException(OUT_OF_SCOPE_REASON);

    // The target must be a real stage of this lead's own pipeline, checked against
    // the canonical catalogue (KAN-05.1) — an unknown stage is a clear 400 before any
    // write (AC4), and the check is pipeline-aware, which a static list never was.
    if (!(await this.stages.exists(current.pipeline, dto.stage))) {
      throw new BadRequestException('stage must be a known pipeline stage');
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      // Same capture rule as the row action: LOST stores the reason, anything else clears it.
      data: {
        status: dto.stage,
        lostReason: dto.stage === LOST_STATUS ? (dto.lostReason ?? null) : null,
      },
      select: LEAD_LIST_SELECT,
    });

    // Recount only the affected columns (source + target) within the lead's
    // pipeline and the caller's scope. A move that empties its source column
    // leaves that stage out of the groupBy, so backfill it to a zeroed column —
    // the board must be told a column dropped to 0, not left showing its old count.
    const affected = [...new Set([current.status, dto.stage])];
    const summaries = await this.stageSummaries(
      buildLeadWhere(user, { pipeline: current.pipeline, status: affected }),
    );
    const byStage = new Map(summaries.map((s) => [s.stage, s]));
    const stages = affected.map(
      (stage) => byStage.get(stage) ?? { stage, count: 0, totalValue: '0' },
    );

    return {
      lead: toLeadListItem(updated),
      pipeline: current.pipeline,
      stages,
    };
  }

  /**
   * Leads grouped by stage for a scoped `where`, as column rollups. Shared by the
   * board rollup and the stage-change recount so both count and sum a stage the
   * same way. A stage with no leads is absent from the result (groupBy returns only
   * present keys); callers that need a zeroed column backfill it.
   */
  private async stageSummaries(
    where: Prisma.LeadWhereInput,
  ): Promise<BoardStageSummary[]> {
    const grouped = await this.prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: { actualAmount: true },
      orderBy: { status: 'asc' },
    });

    return grouped.map((row) => ({
      stage: row.status,
      count: row._count,
      totalValue: row._sum.actualAmount?.toString() ?? '0',
    }));
  }
}
