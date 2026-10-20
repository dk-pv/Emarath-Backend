import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TagAccessMode, UserRole } from '../generated/prisma/client';
import { SALES_MODULE_ROLES } from '../auth/role-groups';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditState,
  recordAuditEvents,
  stateChangeEvents,
  userActor,
} from '../audit/audit-events';
import {
  TeamTagAccessNode,
  SaveTeamTagAccessDto,
  SaveUserTagAccessDto,
  TagAccessOverview,
  UserTagAccessNode,
} from './dto/tag-access.dto';
import { resolveTagAccess } from './tag-access';
import { POLICY_SELECT, PolicyRow, toPolicy } from './tag-access.service';

/** The users an override can apply to: sales roles other than the administrator. */
const OVERRIDABLE_ROLES: readonly UserRole[] = SALES_MODULE_ROLES.filter(
  (role) => role !== UserRole.SUPERADMIN,
);

/** Which policy a change is about: a team's default or one user's override. */
type PolicyKey = { team: string } | { userId: string };

/**
 * A policy as its history records it (AUD-01). No stored policy reads as all-null, which is what
 * the resolver makes of it too: the pre-feature default for a team, "inherit" for a user.
 */
function policyState(row: PolicyRow | null): AuditState {
  return {
    canCreate: row?.canCreate ?? null,
    tagAccess: row?.tagAccess ?? null,
    tagIds: (row?.grants.map((grant) => grant.tagId) ?? []).sort(),
  };
}

/**
 * The Admin's side of Tag Permissions (ADR-0091): read the whole matrix, and set or reset a
 * team's default or one user's override. Every method is reached only through
 * SUPERADMIN-gated routes, so a user cannot change their own — or anyone's — permissions.
 */
@Injectable()
export class TagPermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /**
   * Every team and every overridable user with what they currently get.
   *
   * A team is listed when users carry it as their team *or* a policy is saved for it,
   * so a policy for a team that has since emptied is still visible and can be reset.
   */
  async overview(): Promise<TagAccessOverview> {
    const [groups, users, policies] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['team'],
        where: { team: { not: null }, deletedAt: null, isActive: true },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          role: { in: [...OVERRIDABLE_ROLES] },
        },
        select: { id: true, name: true, role: true, team: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.tagAccessPolicy.findMany({ select: POLICY_SELECT }),
    ]);

    const byTeam = new Map<string, PolicyRow>();
    const byUser = new Map<string, PolicyRow>();
    for (const policy of policies) {
      if (policy.team !== null) byTeam.set(policy.team, policy);
      if (policy.userId !== null) byUser.set(policy.userId, policy);
    }

    const members = new Map<string, number>();
    for (const row of groups) {
      if (row.team !== null) members.set(row.team, row._count._all);
    }

    const names = new Set([...members.keys(), ...byTeam.keys()]);
    const teams: TeamTagAccessNode[] = [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((team) => {
        const policy = byTeam.get(team);
        return {
          team,
          memberCount: members.get(team) ?? 0,
          configured: policy !== undefined,
          canCreate: policy?.canCreate ?? false,
          tagAccess: policy?.tagAccess ?? TagAccessMode.ALL,
          tagIds: policy?.grants.map((grant) => grant.tagId) ?? [],
        };
      });

    const userNodes: UserTagAccessNode[] = users.map((user) => {
      const own = byUser.get(user.id);
      const effective = resolveTagAccess(
        toPolicy(user.team ? byTeam.get(user.team) : undefined),
        toPolicy(own),
      );
      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        team: user.team,
        override: own
          ? {
              canCreate: own.canCreate,
              tagAccess: own.tagAccess,
              tagIds: own.grants.map((grant) => grant.tagId),
            }
          : null,
        effective: {
          canCreate: effective.canCreate,
          tagAccess: effective.allowedTagIds
            ? TagAccessMode.LISTED
            : TagAccessMode.ALL,
          tagIds: effective.allowedTagIds ? [...effective.allowedTagIds] : [],
        },
      };
    });

    return { teams, users: userNodes };
  }

  async saveTeam(dto: SaveTeamTagAccessDto): Promise<TagAccessOverview> {
    // The tag list only means something for LISTED; for ALL it is cleared, never validated.
    if (dto.tagAccess === TagAccessMode.LISTED) {
      await this.assertTagsExist(dto.tagIds);
    }

    await this.recorded({ team: dto.team }, 'tag-access.team', async (tx) => {
      const policy = await tx.tagAccessPolicy.upsert({
        where: { team: dto.team },
        create: {
          team: dto.team,
          canCreate: dto.canCreate,
          tagAccess: dto.tagAccess,
        },
        update: { canCreate: dto.canCreate, tagAccess: dto.tagAccess },
        select: { id: true },
      });
      await this.replaceGrants(tx, policy.id, dto.tagAccess, dto.tagIds);
    });
    return this.overview();
  }

  /** Back to "as before" for this team. Idempotent. */
  async resetTeam(team: string): Promise<TagAccessOverview> {
    await this.recorded({ team }, 'tag-access.team-reset', (tx) =>
      tx.tagAccessPolicy.deleteMany({ where: { team } }),
    );
    return this.overview();
  }

  async saveUser(
    userId: string,
    dto: SaveUserTagAccessDto,
  ): Promise<TagAccessOverview> {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (!OVERRIDABLE_ROLES.includes(target.role)) {
      throw new BadRequestException(
        'Tag permissions apply to sales users. Administrators are never restricted, and post-sale roles do not use tags.',
      );
    }

    const canCreate = dto.canCreate ?? null;
    const tagAccess = dto.tagAccess ?? null;
    // Nothing overridden is no override: the user simply inherits their team.
    if (canCreate === null && tagAccess === null) {
      return this.resetUser(userId);
    }

    const tagIds = dto.tagIds ?? [];
    if (tagAccess === TagAccessMode.LISTED) await this.assertTagsExist(tagIds);

    await this.recorded({ userId }, 'tag-access.user', async (tx) => {
      const policy = await tx.tagAccessPolicy.upsert({
        where: { userId },
        create: { user: { connect: { id: userId } }, canCreate, tagAccess },
        update: { canCreate, tagAccess },
        select: { id: true },
      });
      await this.replaceGrants(tx, policy.id, tagAccess, tagIds);
    });
    return this.overview();
  }

  /** Back to inheriting the team. Idempotent. */
  async resetUser(userId: string): Promise<TagAccessOverview> {
    await this.recorded({ userId }, 'tag-access.user-reset', (tx) =>
      tx.tagAccessPolicy.deleteMany({ where: { userId } }),
    );
    return this.overview();
  }

  /**
   * Runs one policy write and records what it changed (AUD-01), in one transaction. The policy
   * row is locked before it is read, so the before-state is the one the write replaced; a write
   * that changes nothing — a repeated save, a reset of a policy that does not exist — records
   * nothing.
   */
  private async recorded(
    key: PolicyKey,
    source: string,
    write: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<void> {
    const actor = userActor(await this.currentUser.resolve());
    const where: Prisma.TagAccessPolicyWhereUniqueInput =
      'team' in key ? { team: key.team } : { userId: key.userId };

    await this.prisma.$transaction(async (tx) => {
      if ('team' in key) {
        await tx.$queryRaw`SELECT id FROM tag_access_policies WHERE team = ${key.team} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM tag_access_policies WHERE user_id = ${key.userId}::uuid FOR UPDATE`;
      }
      const before = await tx.tagAccessPolicy.findUnique({
        where,
        select: POLICY_SELECT,
      });
      await write(tx);
      const after = await tx.tagAccessPolicy.findUnique({
        where,
        select: POLICY_SELECT,
      });

      const policyId = after?.id ?? before?.id;
      if (!policyId) return;
      const events = stateChangeEvents(
        {
          entityType: 'TAG_ACCESS_POLICY',
          entityId: policyId,
          leadId: null,
          actor,
          source,
          metadata: key,
        },
        policyState(before),
        policyState(after),
      ).map((event) => ({ ...event, action: 'PERMISSIONS_CHANGED' as const }));
      if (events.length > 0) await recordAuditEvents(tx, events);
    });
  }

  /** Grants exist only for `LISTED`; any other mode leaves the policy with none. */
  private async replaceGrants(
    tx: Prisma.TransactionClient,
    policyId: string,
    tagAccess: TagAccessMode | null,
    tagIds: readonly string[],
  ): Promise<void> {
    await tx.tagAccessGrant.deleteMany({ where: { policyId } });
    if (tagAccess === TagAccessMode.LISTED && tagIds.length > 0) {
      await tx.tagAccessGrant.createMany({
        data: tagIds.map((tagId) => ({ policyId, tagId })),
      });
    }
  }

  private async assertTagsExist(tagIds: readonly string[]): Promise<void> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return;
    const found = await this.prisma.tag.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (found !== unique.length) {
      throw new BadRequestException('One or more of those tags do not exist.');
    }
  }
}
