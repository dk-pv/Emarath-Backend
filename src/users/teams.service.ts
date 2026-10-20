import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { TEAM_MEMBER_ROLES } from '../auth/role-groups';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditActor,
  AuditEventInput,
  recordAuditEvents,
  userActor,
} from '../audit/audit-events';
import { userEvent } from './user-audit';
import {
  assertTeamMemberRole,
  findTeamLabel,
  isTeamMemberRole,
  lockTeams,
} from './team-label';
import {
  AssignTeamDto,
  CreateTeamDto,
  RenameTeamDto,
  TeamMemberEntry,
  TeamSummary,
  TeamsOverview,
} from './dto/team.dto';

/** ponytail: the whole staff directory in one read; page it if the roster ever nears this. */
const MAX_DIRECTORY = 1000;

const MEMBER_SELECT = {
  id: true,
  name: true,
  role: true,
  orgRole: { select: { name: true } },
  team: true,
  isActive: true,
  monthlyGoalAmount: true,
} satisfies Prisma.UserSelect;

/**
 * Teams v1 (client acceptance criterion 11): BDE teams over the existing `User.team` label, with no
 * migration. A team is the set of live accounts carrying one label, so it exists while someone
 * belongs to it, each person is in at most one team, and its target is derived from its members'
 * monthly goals. Every route is Super Admin only, like the rest of team member administration.
 *
 * Each write runs under `lockTeams`, changes the label on the accounts it names, and records each
 * changed account as a USER UPDATED event with the team before and after (AUD-01), in the same
 * transaction. A rename also carries the team's Tag Permissions policy to the new name, because
 * the policy is keyed by the name and would otherwise stop applying.
 *
 * Who a Sales Manager sees follows the team label on their session token, which is refreshed at
 * the latest after the access-token lifetime — the same as any change made in the member form.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async overview(): Promise<TeamsOverview> {
    const [rows, counts, goals, policies, unassigned] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        select: MEMBER_SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: MAX_DIRECTORY,
      }),
      this.prisma.user.groupBy({
        by: ['team', 'isActive'],
        where: { deletedAt: null, team: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['team'],
        where: { deletedAt: null, isActive: true, team: { not: null } },
        _sum: { monthlyGoalAmount: true },
      }),
      this.prisma.tagAccessPolicy.findMany({
        where: { team: { not: null } },
        select: { team: true },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          team: null,
          role: { in: [...TEAM_MEMBER_ROLES] },
        },
      }),
    ]);

    const members: TeamMemberEntry[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      roleName: row.orgRole?.name ?? null,
      team: row.team,
      isActive: row.isActive,
      monthlyGoalAmount: row.monthlyGoalAmount?.toString() ?? null,
      eligible: isTeamMemberRole(row.role),
    }));

    const byTeam = new Map<string, { all: number; active: number }>();
    for (const group of counts) {
      if (group.team === null) continue;
      const entry = byTeam.get(group.team) ?? { all: 0, active: 0 };
      entry.all += group._count._all;
      if (group.isActive) entry.active += group._count._all;
      byTeam.set(group.team, entry);
    }
    const goalByTeam = new Map(
      goals.map((goal) => [goal.team, goal._sum.monthlyGoalAmount]),
    );
    const withPolicy = new Set(policies.map((policy) => policy.team));

    const teams: TeamSummary[] = [...byTeam]
      .map(([name, count]) => ({
        name,
        memberCount: count.all,
        activeMemberCount: count.active,
        targetTotal: goalByTeam.get(name)?.toString() ?? null,
        managers: members
          .filter(
            (member) =>
              member.team === name &&
              member.isActive &&
              member.role === UserRole.SALES_MANAGER,
          )
          .map((member) => member.name),
        tagPermissions: withPolicy.has(name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { teams, members, unassigned };
  }

  /** A new team named `name`, with its first members moved into it from wherever they were. */
  async create(dto: CreateTeamDto): Promise<TeamsOverview> {
    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await lockTeams(tx);
      const existing = await findTeamLabel(tx, dto.name);
      if (existing !== null) {
        throw new ConflictException(
          `A team named "${existing}" already exists.`,
        );
      }
      await this.move(tx, dto.name, dto.memberIds, actor, 'teams.create');
    });
    return this.overview();
  }

  /**
   * Renames a team on every account carrying it — removed accounts included, so their past leads
   * report under the new name too — and moves the team's Tag Permissions policy with it.
   */
  async rename(dto: RenameTeamDto): Promise<TeamsOverview> {
    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await lockTeams(tx);
      const current = await findTeamLabel(tx, dto.name);
      if (current === null) {
        throw new NotFoundException(`No team named "${dto.name}".`);
      }
      if (dto.newName === current) return;

      // Another spelling of the new name is another team; the current label itself is not (a
      // rename that only changes case is allowed). NOT is exact, unlike the insensitive match.
      const clash = await tx.user.findFirst({
        where: {
          deletedAt: null,
          team: { equals: dto.newName, mode: 'insensitive' },
          NOT: { team: current },
        },
        select: { team: true },
      });
      if (clash) {
        throw new ConflictException(
          `A team named "${clash.team}" already exists. To combine the two, move this team's members into it instead.`,
        );
      }

      const policies = await tx.$queryRaw<{ id: string; team: string }[]>`
        SELECT id, team FROM tag_access_policies
        WHERE team IN (${current}, ${dto.newName}) FOR UPDATE`;
      if (policies.some((policy) => policy.team === dto.newName)) {
        throw new ConflictException(
          `Tag permissions are already saved for a team named "${dto.newName}". Reset them in Tag Permissions before using that name.`,
        );
      }

      const renamed = await tx.user.findMany({
        where: { team: current },
        select: { id: true },
      });
      await tx.user.updateMany({
        where: { team: current },
        data: { team: dto.newName },
      });
      const events: AuditEventInput[] = renamed.map((user) =>
        userEvent(user.id, 'UPDATED', actor, 'teams.rename', {
          before: { team: current },
          after: { team: dto.newName },
        }),
      );

      const policy = policies.find((row) => row.team === current);
      if (policy) {
        await tx.tagAccessPolicy.update({
          where: { id: policy.id },
          data: { team: dto.newName },
        });
        events.push({
          entityType: 'TAG_ACCESS_POLICY',
          entityId: policy.id,
          leadId: null,
          action: 'RENAMED',
          actor,
          source: 'teams.rename',
          before: { team: current },
          after: { team: dto.newName },
          metadata: { team: dto.newName },
        });
      }
      await recordAuditEvents(tx, events);
    });
    return this.overview();
  }

  /**
   * Moves people into an existing team (out of any other: one team per person), or out of their
   * team with `team: null`. Taking out a team's last members ends the team; its Tag Permissions
   * policy stays saved under the name, as Tag Permissions already shows for an emptied team.
   */
  async assign(dto: AssignTeamDto): Promise<TeamsOverview> {
    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await lockTeams(tx);
      let team: string | null = null;
      if (dto.team !== null) {
        team = await findTeamLabel(tx, dto.team);
        if (team === null) {
          throw new NotFoundException(
            `No team named "${dto.team}". Create it with its first members instead.`,
          );
        }
      }
      await this.move(
        tx,
        team,
        dto.userIds,
        actor,
        team === null ? 'teams.remove' : 'teams.assign',
      );
    });
    return this.overview();
  }

  /**
   * Sets `team` on the named live accounts. Every id must be a live account, and only sales users
   * may join a team; anyone already there is left alone and records nothing.
   */
  private async move(
    tx: Prisma.TransactionClient,
    team: string | null,
    ids: string[],
    actor: AuditActor,
    source: string,
  ): Promise<void> {
    const users = await tx.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true, role: true, team: true },
    });
    if (users.length !== ids.length) {
      throw new BadRequestException(
        'One or more of those team members do not exist.',
      );
    }
    if (team !== null) {
      for (const user of users) assertTeamMemberRole(user.role, user.name);
    }

    const changed = users.filter((user) => user.team !== team);
    if (changed.length === 0) return;
    await tx.user.updateMany({
      where: { id: { in: changed.map((user) => user.id) } },
      data: { team },
    });
    await recordAuditEvents(
      tx,
      changed.map((user) =>
        userEvent(user.id, 'UPDATED', actor, source, {
          before: { team: user.team },
          after: { team },
        }),
      ),
    );
  }
}
