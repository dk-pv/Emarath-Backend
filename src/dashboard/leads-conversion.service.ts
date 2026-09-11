import { Injectable } from '@nestjs/common';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { buildLeadWhere } from '../leads/lead-where';
import { CONVERTED_STATUS } from '../reports/converted-leads-where';
import { NO_SOURCE_LABEL } from '../reports/dto/leads-by-source-response.dto';
import { LeadsConversionQueryDto } from './dto/leads-conversion-query.dto';

/** The widget's two breakdowns — the reference's Lead Source / Sales Team toggle. */
export const LEADS_CONVERSION_BREAKDOWNS = ['source', 'team'] as const;
export type LeadsConversionBreakdown =
  (typeof LEADS_CONVERSION_BREAKDOWNS)[number];

/** Leads with no assignee at all, so the team breakdown accounts for every lead. */
export const UNASSIGNED_LABEL = 'Unassigned';

export interface LeadsConversionRow {
  category: string;
  leadCount: number;
  convertedCount: number;
}

export interface LeadsConversionTotals {
  leadCount: number;
  convertedCount: number;
}

export interface LeadsConversion {
  rows: LeadsConversionRow[];
  /**
   * **Distinct** leads in scope and period.
   *
   * For `source` this equals the row sum — a lead carries one source. For `team` the
   * rows can sum higher: a lead assigned to two agents counts for each of them, which
   * is the same rule the Leads By Ownership report already applies (its donut carries
   * a separate `sliceTotal` for exactly this reason). Both figures are returned so a
   * caller can reconcile either way rather than guess which one a sum should match.
   */
  totals: LeadsConversionTotals;
}

/**
 * Leads vs Conversion (DASH-11.1).
 *
 * Two counts per category — leads, and of those the converted ones — broken down by
 * acquisition source or by the sales team member the lead is assigned to.
 *
 * **Not one new rule.** "Converted" is `CONVERTED_STATUS` ('WON'), the approved
 * definition the Converted Leads report and the Leads quick filter already share, so
 * this chart cannot disagree with either. Scope, soft-delete and the period window
 * all arrive inside `buildLeadWhere` — the one builder every lead read composes — so
 * an agent's chart holds only their own leads and the window is applied in the query.
 *
 * The reference's "Sales Team" axis is a list of **people** (RANJITH LAL, ADWAITHA
 * T M …), not of teams, so the breakdown groups by assignee through `LeadAssignment`
 * — the same relation `teamWhere` and the leaderboard read.
 */
@Injectable()
export class LeadsConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getLeadsConversion(
    query: LeadsConversionQueryDto,
  ): Promise<LeadsConversion> {
    const user = await this.currentUser.resolve();
    const where = buildLeadWhere(user, {
      createdFrom: query.from,
      createdTo: query.to,
    });
    const convertedWhere = buildLeadWhere(user, {
      createdFrom: query.from,
      createdTo: query.to,
      status: [CONVERTED_STATUS],
    });

    const [rows, leadCount, convertedCount] = await Promise.all([
      query.breakdown === 'team'
        ? this.byTeam(where, convertedWhere)
        : this.bySource(where, convertedWhere),
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: convertedWhere }),
    ]);

    return { rows, totals: { leadCount, convertedCount } };
  }

  /**
   * One row per source present in the period. Null and blank sources fold into the
   * one "No Source" bucket the Leads By Source report defines, so every lead is
   * accounted for and the row sum equals the distinct total.
   */
  private async bySource(
    where: ReturnType<typeof buildLeadWhere>,
    convertedWhere: ReturnType<typeof buildLeadWhere>,
  ): Promise<LeadsConversionRow[]> {
    // Two groupBys, never a query per source. (`groupBy` can't ride a `$transaction`
    // array — its generics don't infer there — so these pair with `Promise.all`, as
    // the sibling reports do.)
    const [all, converted] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['source'],
        where: convertedWhere,
        _count: { _all: true },
      }),
    ]);

    const fold = (
      groups: { source: string | null; _count: { _all: number } }[],
    ): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const group of groups) {
        const label =
          group.source && group.source.trim() !== ''
            ? group.source
            : NO_SOURCE_LABEL;
        counts.set(label, (counts.get(label) ?? 0) + group._count._all);
      }
      return counts;
    };

    const leads = fold(all);
    const wins = fold(converted);
    return [...leads.entries()]
      .map(([category, leadCount]) => ({
        category,
        leadCount,
        convertedCount: wins.get(category) ?? 0,
      }))
      .sort(byCategory);
  }

  /**
   * One row per assignee, plus an "Unassigned" bucket so no lead is silently dropped.
   *
   * Counts are of assignment rows, which is one row per (lead, agent) — so an agent's
   * bar is the leads *they* hold, and a lead shared by two agents contributes to both.
   * That is the Leads By Ownership rule, not a new one; `totals` carries the distinct
   * figure alongside for reconciliation.
   */
  private async byTeam(
    where: ReturnType<typeof buildLeadWhere>,
    convertedWhere: ReturnType<typeof buildLeadWhere>,
  ): Promise<LeadsConversionRow[]> {
    const [all, converted, unassigned, unassignedWon] = await Promise.all([
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: { lead: where },
        _count: { _all: true },
      }),
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: { lead: convertedWhere },
        _count: { _all: true },
      }),
      this.prisma.lead.count({
        where: { AND: [where, { assignments: { none: {} } }] },
      }),
      this.prisma.lead.count({
        where: { AND: [convertedWhere, { assignments: { none: {} } }] },
      }),
    ]);

    const wins = new Map(
      converted.map((group) => [group.userId, group._count._all]),
    );
    const names = await this.namesByUser(all.map((group) => group.userId));

    const rows: LeadsConversionRow[] = all
      .map((group) => ({
        category: names.get(group.userId) ?? UNASSIGNED_LABEL,
        leadCount: group._count._all,
        convertedCount: wins.get(group.userId) ?? 0,
      }))
      .sort(byCategory);

    // Only when it carries something: an empty bucket would draw a bar for nobody.
    if (unassigned > 0) {
      rows.push({
        category: UNASSIGNED_LABEL,
        leadCount: unassigned,
        convertedCount: unassignedWon,
      });
    }
    return rows;
  }

  private async namesByUser(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    return new Map(users.map((entry) => [entry.id, entry.name]));
  }
}

/**
 * Alphabetical, with the catch-all bucket last — the order the reference's source
 * axis reads (Broadcast · Cancel/Reorder · Complaint · Direct) and the one the Leads
 * By Source report already established. The reference's *team* axis follows no order
 * derivable from the capture, so it takes the same rule rather than a second one.
 */
function byCategory(a: LeadsConversionRow, b: LeadsConversionRow): number {
  const catchAll = (row: LeadsConversionRow) =>
    Number(
      row.category === NO_SOURCE_LABEL || row.category === UNASSIGNED_LABEL,
    );
  return (
    catchAll(a) - catchAll(b) ||
    a.category.localeCompare(b.category, undefined, { sensitivity: 'base' })
  );
}
