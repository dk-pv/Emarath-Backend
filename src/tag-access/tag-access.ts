import { TagAccessMode } from '../generated/prisma/client';

/** One stored policy, flattened: its two settings and the tags it lists. */
export interface TagPolicy {
  /** Null only on a user override: inherit the team's value. */
  canCreate: boolean | null;
  /** Null only on a user override: inherit the team's value. */
  tagAccess: TagAccessMode | null;
  /** Meaningful only when `tagAccess` is `LISTED`. */
  tagIds: readonly string[];
}

/** What one person may do with tags, once the team default and their override meet. */
export interface EffectiveTagAccess {
  canCreate: boolean;
  /** Null means every tag. Otherwise only these. */
  allowedTagIds: ReadonlySet<string> | null;
}

/** An administrator is never restricted — the same rule as every other admin-only catalogue. */
export const FULL_TAG_ACCESS: EffectiveTagAccess = {
  canCreate: true,
  allowedTagIds: null,
};

/**
 * What a user with no applicable policy gets: today's behaviour. Every active tag can be
 * selected, and only an administrator creates tags (the Tags catalogue is SUPERADMIN-only).
 * Introducing the policy table therefore changes nobody's access until the Admin saves one.
 */
export const DEFAULT_TAG_ACCESS: EffectiveTagAccess = {
  canCreate: false,
  allowedTagIds: null,
};

/**
 * The precedence rule, in one place (ADR-0091):
 *
 * 1. a field the user's own override sets wins;
 * 2. otherwise the user's team sets it;
 * 3. otherwise the default above.
 *
 * The two fields resolve independently, so an override that only widens tag creation leaves
 * the team's tag list in force. An override that sets `LISTED` replaces the team's
 * list outright rather than adding to it — "takes precedence" has to mean one list wins, and a
 * merged list could never be narrower than the team's.
 */
export function resolveTagAccess(
  team: TagPolicy | null,
  user: TagPolicy | null,
): EffectiveTagAccess {
  const canCreate =
    user?.canCreate ?? team?.canCreate ?? DEFAULT_TAG_ACCESS.canCreate;

  const governing =
    user?.tagAccess != null ? user : team?.tagAccess != null ? team : null;

  return {
    canCreate,
    allowedTagIds:
      governing?.tagAccess === TagAccessMode.LISTED
        ? new Set(governing.tagIds)
        : null,
  };
}

/** Whether `tagId` may be selected — added to a lead, or taken off it. */
export function mayHandleTag(
  access: EffectiveTagAccess,
  tagId: string,
): boolean {
  return access.allowedTagIds === null || access.allowedTagIds.has(tagId);
}
