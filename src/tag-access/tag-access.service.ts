import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, TagAccessMode, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LookupOption } from '../lookups/lookups.data';
import {
  EffectiveTagAccess,
  FULL_TAG_ACCESS,
  TagPolicy,
  mayHandleTag,
  resolveTagAccess,
} from './tag-access';

export const TAG_NOT_PERMITTED =
  'You do not have permission to use one or more of these tags.';
export const TAG_CREATE_NOT_PERMITTED =
  'You do not have permission to create tags.';

export const POLICY_SELECT = {
  id: true,
  team: true,
  userId: true,
  canCreate: true,
  tagAccess: true,
  grants: { select: { tagId: true } },
} satisfies Prisma.TagAccessPolicySelect;

export type PolicyRow = Prisma.TagAccessPolicyGetPayload<{
  select: typeof POLICY_SELECT;
}>;

/** A stored row as the pure resolver reads it. */
export function toPolicy(row: PolicyRow | undefined): TagPolicy | null {
  return row
    ? {
        canCreate: row.canCreate,
        tagAccess: row.tagAccess,
        tagIds: row.grants.map((grant) => grant.tagId),
      }
    : null;
}

/** What `GET /tag-access/me` answers: the caller's effective permissions, ready to render. */
export interface MyTagAccess {
  canCreate: boolean;
  /** True when the caller may select only some tags (so the UI can say why a tag is absent). */
  restricted: boolean;
  /** The active tags the caller may select, in name order. */
  tags: LookupOption[];
}

/**
 * Resolves and enforces Tag Permissions (ADR-0091).
 *
 * Everything that writes a lead's tags or creates a tag asks this service, so the rule lives
 * in one place and a client cannot get around it by calling a different endpoint. The
 * caller's team is read from the database, not the access token: the token's `team`
 * claim lives until it is refreshed, and moving someone to another team has to take
 * effect on their next request.
 */
@Injectable()
export class TagAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's team policy and own override, if any. */
  private async load(
    db: Prisma.TransactionClient | PrismaService,
    user: CurrentUser,
  ): Promise<{
    team: PolicyRow | undefined;
    own: PolicyRow | undefined;
  }> {
    const account = await db.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { team: true },
    });
    const team = account?.team ?? null;

    const rows = await db.tagAccessPolicy.findMany({
      where: {
        OR: [{ userId: user.id }, ...(team ? [{ team }] : [])],
      },
      select: POLICY_SELECT,
    });
    return {
      team: rows.find((row) => row.team !== null),
      own: rows.find((row) => row.userId !== null),
    };
  }

  async resolve(user: CurrentUser): Promise<EffectiveTagAccess> {
    if (user.role === UserRole.SUPERADMIN) return FULL_TAG_ACCESS;
    const { team, own } = await this.load(this.prisma, user);
    return resolveTagAccess(toPolicy(team), toPolicy(own));
  }

  /**
   * Throws unless every tag may be selected by the caller — the gate for adding a tag to a
   * lead, taking one off, and creating or editing a lead with tags.
   */
  async assertMayHandle(
    user: CurrentUser,
    tagIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0 || user.role === UserRole.SUPERADMIN) return;

    const access = await this.resolve(user);
    if (!unique.every((tagId) => mayHandleTag(access, tagId))) {
      throw new ForbiddenException(TAG_NOT_PERMITTED);
    }
  }

  /** The subset of `tagIds` the caller may select — for a copy that must not widen access. */
  async handleable(
    user: CurrentUser,
    tagIds: readonly string[],
  ): Promise<string[]> {
    if (tagIds.length === 0) return [];
    const access = await this.resolve(user);
    return tagIds.filter((tagId) => mayHandleTag(access, tagId));
  }

  async assertMayCreate(user: CurrentUser): Promise<void> {
    if (user.role === UserRole.SUPERADMIN) return;
    const access = await this.resolve(user);
    if (!access.canCreate)
      throw new ForbiddenException(TAG_CREATE_NOT_PERMITTED);
  }

  /**
   * Lets a creator use the tag they just made. Without this, a `LISTED` policy would let a
   * person create a tag they could not then select, which would make the permission useless.
   * The tag goes onto whichever policy currently governs the creator's selection — their own
   * override, else their team's — and nowhere else, so a creator never widens a policy
   * that is not theirs, and an unrestricted creator needs no grant at all.
   */
  async grantToCreator(
    tx: Prisma.TransactionClient,
    user: CurrentUser,
    tagId: string,
  ): Promise<boolean> {
    const { team, own } = await this.load(tx, user);
    const governing =
      own?.tagAccess != null ? own : team?.tagAccess != null ? team : undefined;
    if (governing?.tagAccess !== TagAccessMode.LISTED) return false;

    await tx.tagAccessGrant.create({
      data: { policyId: governing.id, tagId },
    });
    return true;
  }

  /** What the tag pickers render for the caller. */
  async mine(user: CurrentUser): Promise<MyTagAccess> {
    const access = await this.resolve(user);
    const tags = await this.prisma.tag.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(access.allowedTagIds
          ? { id: { in: [...access.allowedTagIds] } }
          : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      canCreate: access.canCreate,
      restricted: access.allowedTagIds !== null,
      tags: tags.map((tag) => ({ value: tag.id, label: tag.name })),
    };
  }
}
