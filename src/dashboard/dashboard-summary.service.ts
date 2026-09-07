import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { leadScopeWhere } from '../leads/lead-scope';
import {
  DisplayOnCards,
  SummaryMode,
} from '../settings/dto/application-controls.dto';

/** One configured summary card, carrying both figures so the client renders either. */
export interface DashboardSummaryCard {
  fieldKey: string;
  label: string;
  count: number;
  /** Summed `actualAmount` as a string — Decimal precision must survive the wire. */
  amount: string;
}

export interface DashboardSummary {
  summaryMode: SummaryMode;
  displayOnCards: DisplayOnCards;
  cards: DashboardSummaryCard[];
}

/**
 * The dashboard summary the Application Controls → Dashboard Settings screen configures.
 *
 * The card set is not a dashboard decision: the screen names which stages or sources are
 * summarised and in what order, and this returns exactly those, in exactly that order.
 * An empty configuration returns no cards, which is the honest reading of "nothing
 * selected" — never a fallback set nobody chose.
 *
 * The aggregation is the Kanban board's, deliberately: `groupBy` + `_count` + summed
 * `actualAmount` over `leadScopeWhere`, so a stage card and its board column can never
 * disagree, and an agent's cards count only the agent's own leads. Both counts are
 * index-backed (`@@index([status, deletedAt])` / `@@index([source, deletedAt])`).
 */
@Injectable()
export class DashboardSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly settings: SettingsService,
  ) {}

  async getSummary(): Promise<DashboardSummary> {
    const [user, config] = await Promise.all([
      this.currentUser.resolve(),
      this.settings.getDashboardSettings(),
    ]);

    const selection =
      config.summaryMode === 'LEAD_STAGE'
        ? config.leadStage
        : config.leadSource;
    const keys = selection.map((card) => card.fieldKey);

    const base = {
      summaryMode: config.summaryMode,
      displayOnCards: config.displayOnCards,
    };
    if (keys.length === 0) return { ...base, cards: [] };

    const where: Prisma.LeadWhereInput = {
      AND: [
        leadScopeWhere(user),
        config.summaryMode === 'LEAD_STAGE'
          ? { status: { in: keys } }
          : { source: { in: keys } },
      ],
    };

    const totals =
      config.summaryMode === 'LEAD_STAGE'
        ? await this.byStatus(where)
        : await this.bySource(where);

    // A key with no leads is absent from a groupBy; a configured card must still be
    // drawn, reading zero — the point of choosing it is to watch it fill.
    return {
      ...base,
      cards: selection.map((card) => ({
        fieldKey: card.fieldKey,
        label: card.fieldKey,
        count: totals.get(card.fieldKey)?.count ?? 0,
        amount: totals.get(card.fieldKey)?.amount ?? '0',
      })),
    };
  }

  private async byStatus(
    where: Prisma.LeadWhereInput,
  ): Promise<Map<string, { count: number; amount: string }>> {
    const rows = await this.prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: { actualAmount: true },
    });
    return new Map(
      rows.map((row) => [
        row.status,
        {
          count: row._count,
          amount: row._sum.actualAmount?.toString() ?? '0',
        },
      ]),
    );
  }

  private async bySource(
    where: Prisma.LeadWhereInput,
  ): Promise<Map<string, { count: number; amount: string }>> {
    const rows = await this.prisma.lead.groupBy({
      by: ['source'],
      where,
      _count: true,
      _sum: { actualAmount: true },
    });
    return new Map(
      rows
        .filter((row): row is typeof row & { source: string } =>
          Boolean(row.source),
        )
        .map((row) => [
          row.source,
          {
            count: row._count,
            amount: row._sum.actualAmount?.toString() ?? '0',
          },
        ]),
    );
  }
}
