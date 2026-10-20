import { BadRequestException } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { TEAM_MEMBER_ROLES } from '../auth/role-groups';

/** `users.team` and `tag_access_policies.team` are both VARCHAR(120). */
export const MAX_TEAM_NAME = 120;

/**
 * Teams v1 has no Team table: a team is the `User.team` label its members carry, so two spellings
 * of one name would be two teams. Every write therefore normalises a name the same way — trimmed,
 * runs of whitespace collapsed to one space — and matches existing labels without regard to case,
 * keeping the spelling already stored.
 */
export function normalizeTeamName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * The label a name means, ignoring case, or null when no live user carries it. A team exists only
 * while someone belongs to it; one whose members were all removed is gone.
 */
export async function findTeamLabel(
  db: Prisma.TransactionClient,
  name: string,
): Promise<string | null> {
  const row = await db.user.findFirst({
    where: { deletedAt: null, team: { equals: name, mode: 'insensitive' } },
    select: { team: true },
    orderBy: { team: 'asc' },
  });
  return row?.team ?? null;
}

const TEAMS_LOCK_KEY = 7_201_100;

/**
 * Serialises every write that changes team labels for the rest of the transaction, so a rename
 * and a move — or two renames onto one name — cannot interleave and merge two teams.
 * ponytail: one lock for all team writes (rare admin actions); per-team keys if that ever queues.
 */
export async function lockTeams(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TEAMS_LOCK_KEY})`;
}

export function isTeamMemberRole(role: UserRole): boolean {
  return TEAM_MEMBER_ROLES.includes(role);
}

export function assertTeamMemberRole(role: UserRole, name: string): void {
  if (!isTeamMemberRole(role)) {
    throw new BadRequestException(
      `${name} cannot join a team: teams are for sales users. Administrators and post-sale roles are not placed in teams.`,
    );
  }
}
