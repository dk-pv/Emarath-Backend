import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { ASSIGNABLE_ROLES } from '../auth/role-groups';
import { PrismaService } from '../prisma/prisma.service';
import { CONVERTED_STATUS } from './converted-leads-where';
import { buildLeadsByOwnershipWhere } from './leads-by-ownership-where';
import { achievementPercent, teamLeadsWhere } from './team-lead-where';
import {
  TeamPerformanceFigures,
  TeamPerformanceFilterOptions,
  TeamPerformancePersonRow,
  TeamPerformanceQueryDto,
  TeamPerformanceResponse,
  TeamPerformanceTeamRow,
} from './dto/team-performance.dto';

const ZERO = new Prisma.Decimal(0);
const WON: Prisma.LeadWhereInput = { status: CONVERTED_STATUS };
const HAS_ORDER: Prisma.LeadWhereInput = { logisticsOrder: { isNot: null } };

/** ponytail: the staff directory in one read; page the options if it ever nears this. */
const MAX_OPTIONS = 1000;

const NO_FIGURES: TeamPerformanceFigures = {
  leads: 0,
  won: 0,
  orders: 0,
  conversionRate: 0,
  wonValue: '0',
};

/**
 * Whose rows the caller may see. `teams` null means every team; an empty list means the filters
 * left nothing. A sales agent — and a Sales Manager with no team, whose lead scope is their own
 * leads — sees only their own row.
 */
type Scope = { self: true } | { self: false; teams: string[] | null };

function figures(
  leads: number,
  won: number,
  orders: number,
  wonValue: Prisma.Decimal,
): TeamPerformanceFigures {
  return {
    leads,
    won,
    orders,
    conversionRate: leads > 0 ? Math.round((won / leads) * 10000) / 100 : 0,
    wonValue: wonValue.toString(),
  };
}

function intersect(current: string[] | null, allowed: string[]): string[] {
  return current === null
    ? allowed
    : current.filter((team) => allowed.includes(team));
}

const countsBy = (
  groups: { userId: string; _count: { _all: number } }[],
): Map<string, number> =>
  new Map(groups.map((group) => [group.userId, group._count._all]));

/**
 * Team Performance (Teams v1, client acceptance criterion 11): teams and BDEs compared on leads,
 * won leads, orders, conversion and target achievement, over the leads created in the window.
 *
 * Every figure is read over `buildLeadsByOwnershipWhere` — the caller's lead scope, the window,
 * source, BDE and team — so nothing here reaches a lead the caller could not open. The counting
 * rules:
 * - a BDE's row counts the leads assigned to them, so a co-assigned lead counts for each owner;
 * - a team's row counts its leads (`teamLeadsWhere`), so a lead shared by two members of the team
 *   counts once, and a lead shared across two teams counts once in each;
 * - the total counts the filtered set once, unassigned leads included — never a sum of the rows.
 * Teams are today's labels: a BDE's past leads count for the team they are in now.
 *
 * A Sales Manager sees only their own team (their lead scope already is that team's leads); a
 * sales agent sees only their own row.
 */
@Injectable()
export class TeamPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async report(
    query: TeamPerformanceQueryDto,
  ): Promise<TeamPerformanceResponse> {
    const user = await this.currentUser.resolve();
    const scope = await this.scopeFor(user, query);
    if (!scope.self && scope.teams?.length === 0) {
      return { teams: [], people: [], total: NO_FIGURES };
    }

    const where = buildLeadsByOwnershipWhere(user, {
      from: query.from,
      to: query.to,
      dateField: query.dateField,
      source: query.source,
      agent: query.agent,
      team: scope.self ? undefined : (scope.teams ?? undefined),
    });
    const and = (extra: Prisma.LeadWhereInput): Prisma.LeadWhereInput => ({
      AND: [where, extra],
    });

    const [total, people] = await Promise.all([
      this.figuresOver(where),
      this.people(user, scope, query, where, and),
    ]);
    const teams = scope.self ? [] : await this.teams(scope, people, and);
    return { teams, people, total };
  }

  async filterOptions(): Promise<TeamPerformanceFilterOptions> {
    const user = await this.currentUser.resolve();
    if (this.seesOnlyThemselves(user)) {
      const self = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, name: true, team: true },
      });
      return { teams: [], managers: [], agents: self ? [self] : [] };
    }

    const ownTeam = user.role === UserRole.SALES_MANAGER ? user.team : null;
    const [teams, managers, agents] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          team: ownTeam ? { equals: ownTeam } : { not: null },
        },
        select: { team: true },
        distinct: ['team'],
        orderBy: { team: 'asc' },
      }),
      ownTeam ? [] : this.managerOptions(),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          role: { in: [...ASSIGNABLE_ROLES] },
          ...(ownTeam ? { team: ownTeam } : {}),
        },
        select: { id: true, name: true, team: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: MAX_OPTIONS,
      }),
    ]);
    return {
      teams: teams
        .map((row) => row.team)
        .filter((team): team is string => team !== null),
      managers,
      agents,
    };
  }

  /** The Sales Managers an org-wide caller may narrow to: the active ones with a team. */
  private async managerOptions(): Promise<
    TeamPerformanceFilterOptions['managers']
  > {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: UserRole.SALES_MANAGER,
        team: { not: null },
      },
      select: { id: true, name: true, team: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_OPTIONS,
    });
    return rows.flatMap((row) =>
      row.team ? [{ id: row.id, name: row.name, team: row.team }] : [],
    );
  }

  /** The active lead-handling members of the teams in view (every team when `teams` is null). */
  private async teamMemberIds(teams: string[] | null): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { in: [...ASSIGNABLE_ROLES] },
        team: teams ? { in: teams } : { not: null },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private seesOnlyThemselves(user: CurrentUser): boolean {
    return (
      user.role === UserRole.SALES_AGENT ||
      (user.role === UserRole.SALES_MANAGER && !user.team)
    );
  }

  private async scopeFor(
    user: CurrentUser,
    query: TeamPerformanceQueryDto,
  ): Promise<Scope> {
    if (this.seesOnlyThemselves(user)) return { self: true };

    let teams: string[] | null = query.team?.length ? query.team : null;
    if (query.manager) {
      const manager = await this.prisma.user.findFirst({
        where: {
          id: query.manager,
          deletedAt: null,
          role: UserRole.SALES_MANAGER,
        },
        select: { team: true },
      });
      if (!manager) {
        throw new BadRequestException('That Sales Manager does not exist.');
      }
      if (!manager.team) {
        throw new BadRequestException('That Sales Manager has no team.');
      }
      teams = intersect(teams, [manager.team]);
    }
    if (user.role === UserRole.SALES_MANAGER && user.team) {
      teams = intersect(teams, [user.team]);
    }
    return { self: false, teams };
  }

  /**
   * One row per BDE: everyone with a lead in the set, plus the active lead-handling members of the
   * teams in view, so a member with nothing yet shows as zeros instead of vanishing.
   */
  private async people(
    user: CurrentUser,
    scope: Scope,
    query: TeamPerformanceQueryDto,
    where: Prisma.LeadWhereInput,
    and: (extra: Prisma.LeadWhereInput) => Prisma.LeadWhereInput,
  ): Promise<TeamPerformancePersonRow[]> {
    const teams = scope.self ? null : scope.teams;
    const [owned, won, orders, wonRows, members] = await Promise.all([
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: { lead: where },
        _count: { _all: true },
      }),
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: { lead: and(WON) },
        _count: { _all: true },
      }),
      this.prisma.leadAssignment.groupBy({
        by: ['userId'],
        where: { lead: and(HAS_ORDER) },
        _count: { _all: true },
      }),
      // ponytail: Σ actualAmount per owner summed in-app over the won assignments — the trade
      // Leads By Ownership makes; a scoped raw query if the assignment table ever gets huge.
      this.prisma.leadAssignment.findMany({
        where: { lead: and(WON) },
        select: { userId: true, lead: { select: { actualAmount: true } } },
      }),
      scope.self ? [] : this.teamMemberIds(teams),
    ]);

    const leadCounts = countsBy(owned);
    const wonCounts = countsBy(won);
    const orderCounts = countsBy(orders);
    const wonValue = new Map<string, Prisma.Decimal>();
    for (const row of wonRows) {
      wonValue.set(
        row.userId,
        (wonValue.get(row.userId) ?? ZERO).add(row.lead.actualAmount ?? ZERO),
      );
    }

    let ids = scope.self
      ? [user.id]
      : [
          ...new Set([
            ...leadCounts.keys(),
            ...members,
            ...(query.agent ?? []),
          ]),
        ];
    if (query.agent?.length && !scope.self) {
      ids = ids.filter((id) => query.agent?.includes(id));
    }
    const accounts = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, team: true, monthlyGoalAmount: true },
    });

    return accounts
      .filter(
        (account) =>
          !teams || (account.team !== null && teams.includes(account.team)),
      )
      .map((account) => {
        const value = wonValue.get(account.id) ?? ZERO;
        return {
          userId: account.id,
          name: account.name,
          team: account.team,
          ...figures(
            leadCounts.get(account.id) ?? 0,
            wonCounts.get(account.id) ?? 0,
            orderCounts.get(account.id) ?? 0,
            value,
          ),
          target: account.monthlyGoalAmount?.toString() ?? null,
          achievement: achievementPercent(value, account.monthlyGoalAmount),
        };
      })
      .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  }

  /**
   * One row per team in view: the teams filtered to, or else every team the BDE rows belong to —
   * with a "no team" row when some of them have none.
   * ponytail: four counts per team; one grouped raw query if teams ever number in dozens.
   */
  private async teams(
    scope: Scope,
    people: TeamPerformancePersonRow[],
    and: (extra: Prisma.LeadWhereInput) => Prisma.LeadWhereInput,
  ): Promise<TeamPerformanceTeamRow[]> {
    const names: (string | null)[] =
      !scope.self && scope.teams
        ? scope.teams
        : [...new Set(people.map((person) => person.team))];
    const named = names.filter((team): team is string => team !== null);

    const [byTeam, rows] = await Promise.all([
      this.membersByTeam(named),
      Promise.all(
        names.map(async (team) => ({
          team,
          figures: await this.figuresOver(and(teamLeadsWhere(team))),
        })),
      ),
    ]);

    return rows
      .map(({ team, figures: own }): TeamPerformanceTeamRow => {
        const group = team === null ? undefined : byTeam.get(team);
        const goal = group?.goal ?? null;
        return {
          team,
          ...own,
          members: team === null ? null : (group?.members ?? 0),
          target: goal?.toString() ?? null,
          achievement: achievementPercent(
            new Prisma.Decimal(own.wonValue),
            goal,
          ),
        };
      })
      .sort(
        (a, b) =>
          Number(a.team === null) - Number(b.team === null) ||
          b.leads - a.leads ||
          (a.team ?? '').localeCompare(b.team ?? ''),
      );
  }

  /** Each named team's active members and the sum of their monthly goals (the team target). */
  private async membersByTeam(
    named: string[],
  ): Promise<
    Map<string | null, { members: number; goal: Prisma.Decimal | null }>
  > {
    if (named.length === 0) return new Map();
    const groups = await this.prisma.user.groupBy({
      by: ['team'],
      where: { team: { in: named }, deletedAt: null, isActive: true },
      _count: { _all: true },
      _sum: { monthlyGoalAmount: true },
    });
    return new Map(
      groups.map((group) => [
        group.team,
        { members: group._count._all, goal: group._sum.monthlyGoalAmount },
      ]),
    );
  }

  /** The figures over one lead set, each lead once. */
  private async figuresOver(
    where: Prisma.LeadWhereInput,
  ): Promise<TeamPerformanceFigures> {
    const [leads, won, orders, value] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: { AND: [where, WON] } }),
      this.prisma.lead.count({ where: { AND: [where, HAS_ORDER] } }),
      this.prisma.lead.aggregate({
        where: { AND: [where, WON] },
        _sum: { actualAmount: true },
      }),
    ]);
    return figures(leads, won, orders, value._sum.actualAmount ?? ZERO);
  }
}
