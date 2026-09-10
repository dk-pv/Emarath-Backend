import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  CallLeaderboardService,
  LeaderboardEntry,
} from '../calls/call-leaderboard.service';
import { CallActivityService } from './call-activity.service';

const CALLER = '22222222-2222-2222-2222-222222222222';

const period = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
};

/** The reference board shows 18 agents ("Showing 1 to 18 of 18 rows"). */
const agentId = (index: number) =>
  `aaaaaaaa-aaaa-aaaa-aaaa-${String(index).padStart(12, '0')}`;

function entry(index: number): LeaderboardEntry {
  return {
    agentId: agentId(index),
    agentName: `Agent ${String(index).padStart(2, '0')}`,
    totalCalls: 100 - index,
    uniqueCalls: 50 - index,
    answeredCalls: 40 - index,
    missedCalls: index,
    callConnectPct: 42.5,
    callMinutes: 766.9,
    averageCallTime: 4.65,
  };
}

const ROSTER = Array.from({ length: 18 }, (_, i) => entry(i + 1));

function makeService(entries: LeaderboardEntry[] = ROSTER) {
  const findMany = jest.fn(
    (args: { where: { id: { in: string[] } } }): Promise<unknown[]> =>
      Promise.resolve(
        args.where.id.in.map((id) => ({ id, avatarKey: `avatars/${id}` })),
      ),
  );
  const prisma = { user: { findMany } } as unknown as PrismaService;

  const getSignedDownloadUrl = jest
    .fn()
    .mockResolvedValue('https://signed/avatar');
  const storage = { getSignedDownloadUrl } as unknown as StorageService;

  const getLeaderboard = jest.fn().mockResolvedValue(entries);
  const callLeaderboard = {
    getLeaderboard,
  } as unknown as CallLeaderboardService;

  return {
    service: new CallActivityService(prisma, storage, callLeaderboard),
    findMany,
    getSignedDownloadUrl,
    getLeaderboard,
  };
}

describe('CallActivityService.getCallActivity', () => {
  it('defaults to one 100-row page, the state the reference captures', async () => {
    const { service } = makeService();

    // No page or size: the board opens the way every list in the product does,
    // and 18 agents fit in one page — "Showing 1 to 18 of 18 rows", no pager.
    const result = await service.getCallActivity({ ...period });

    expect(result.total).toBe(18);
    expect(result.rows).toHaveLength(18);
    expect(result.rows[0].agentName).toBe('Agent 01');
    expect(result.rows[17].agentName).toBe('Agent 18');
  });

  it('returns the first page and the full total, not the whole board', async () => {
    const { service, findMany, getSignedDownloadUrl } = makeService();

    const result = await service.getCallActivity({
      ...period,
      page: 1,
      size: 10,
    });

    expect(result.total).toBe(18);
    expect(result.rows).toHaveLength(10);
    expect(result.rows[0].agentName).toBe('Agent 01');
    expect(result.rows[9].agentName).toBe('Agent 10');
    // Only the page's agents are looked up, and only their links are signed —
    // otherwise "paged" would still mint 18 signed URLs per request.
    expect(findMany.mock.calls[0][0].where.id.in).toHaveLength(10);
    expect(getSignedDownloadUrl).toHaveBeenCalledTimes(10);
  });

  it('serves the short final page at the boundary without changing the total', async () => {
    const { service } = makeService();

    const result = await service.getCallActivity({
      ...period,
      page: 2,
      size: 10,
    });

    expect(result.total).toBe(18);
    expect(result.rows).toHaveLength(8);
    expect(result.rows[0].agentName).toBe('Agent 11');
    expect(result.rows[7].agentName).toBe('Agent 18');
  });

  it('returns no rows past the last page, and asks storage for nothing', async () => {
    const { service, findMany, getSignedDownloadUrl } = makeService();

    const result = await service.getCallActivity({
      ...period,
      page: 3,
      size: 10,
    });

    expect(result).toEqual({ rows: [], total: 18 });
    expect(findMany).not.toHaveBeenCalled();
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('counts only what the role-scoped aggregation returned', async () => {
    // What a sales agent's own scope yields: one row, their own. `total` is read
    // from that same result, so paging can never widen it to the team's 18.
    const own = entry(7);
    own.agentId = CALLER;
    const { service } = makeService([own]);

    const result = await service.getCallActivity({
      ...period,
      page: 1,
      size: 100,
    });

    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.agentId)).toEqual([CALLER]);
  });

  it('passes the period through untouched and never leaks paging into it (AC3)', async () => {
    const { service, getLeaderboard } = makeService();

    const result = await service.getCallActivity({
      ...period,
      page: 1,
      size: 10,
    });

    expect(getLeaderboard).toHaveBeenCalledWith({
      from: period.from,
      to: period.to,
    });
    // The five board columns are the aggregation's own figures, unrounded and
    // unrecomputed — this board cannot disagree with the Call Dashboard.
    expect(result.rows[0]).toMatchObject({
      totalCalls: 99,
      uniqueCalls: 49,
      answeredCalls: 39,
      callMinutes: 766.9,
      averageCallTime: 4.65,
    });
  });
});
