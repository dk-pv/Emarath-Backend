import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** The half-open window a Dashboard widget covers, as the client resolved it. */
export interface DashboardPeriod {
  from?: string;
  to?: string;
}

/**
 * The period as a `createdAt`-style filter, or `undefined` for "no date predicate"
 * (the All preset). Kept in one place so the team widgets and the KPI counters
 * treat an absent bound identically.
 */
export function periodFilter(
  period: DashboardPeriod,
): Prisma.DateTimeFilter | undefined {
  if (!period.from && !period.to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (period.from) filter.gte = new Date(period.from);
  if (period.to) filter.lt = new Date(period.to);
  return filter;
}

/**
 * Signed avatar URLs for a set of agents, keyed by user id.
 *
 * The Workpex leaderboard cards and the Call Activity Board rows both show the
 * member's photo, and both fall back to the neutral placeholder when there is
 * none — so this returns `null` for a member without one rather than inventing a
 * URL, and the two surfaces resolve it the same way. Links are short-lived and
 * minted per request, exactly as `UsersService` does; the storage key itself is
 * never sent to the browser.
 */
export async function avatarUrlsByUser(
  prisma: PrismaService,
  storage: StorageService,
  userIds: string[],
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, avatarKey: true },
  });

  const entries = await Promise.all(
    rows.map(async (row): Promise<[string, string | null]> => [
      row.id,
      row.avatarKey
        ? await storage.getSignedDownloadUrl(row.avatarKey, { inline: true })
        : null,
    ]),
  );

  return new Map(entries);
}
