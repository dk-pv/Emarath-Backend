import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { OverdueFollowUpsQueryDto } from './dto/overdue-follow-ups-query.dto';
import { OverdueFollowUpsReportService } from './overdue-follow-ups.service';

/** One assignee's overdue tally, as `activityAssignee.groupBy` returns it. */
function group(userId: string, count: number) {
  return { userId, _count: { _all: count } };
}

/**
 * A service over stubbed Prisma reads: the grouped assignee tallies, their names, and the
 * two counts (unassigned, then the scoped total) the summary asks for, in that order.
 */
function makeService(
  groups: ReturnType<typeof group>[],
  names: { id: string; name: string }[],
  counts: { unassigned: number; total: number },
) {
  const count = jest
    .fn()
    .mockResolvedValueOnce(counts.unassigned)
    .mockResolvedValueOnce(counts.total);
  const prisma = {
    activityAssignee: { groupBy: jest.fn().mockResolvedValue(groups) },
    activity: { count },
    user: { findMany: jest.fn().mockResolvedValue(names) },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: 'admin-1', role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;
  return new OverdueFollowUpsReportService(prisma, currentUser);
}

const query = (over: Partial<OverdueFollowUpsQueryDto> = {}) =>
  ({
    page: 1,
    size: 100,
    todayStart: '2026-09-02T00:00:00.000Z',
    ...over,
  }) as OverdueFollowUpsQueryDto;

const GROUPS = [group('u-carol', 5), group('u-alice', 12), group('u-bob', 3)];
const NAMES = [
  { id: 'u-alice', name: 'Alice Rahman' },
  { id: 'u-bob', name: 'Bilal Nasser' },
  { id: 'u-carol', name: 'Carola Vieira' },
];

describe('OverdueFollowUpsReportService.summary', () => {
  it('returns one row per assignee, A→Z, with the row count as the pager total', async () => {
    const service = makeService(GROUPS, NAMES, { unassigned: 0, total: 18 });

    const result = await service.summary(query());

    expect(result.rows.map((row) => row.agentName)).toEqual([
      'Alice Rahman',
      'Bilal Nasser',
      'Carola Vieira',
    ]);
    expect(result.rows.map((row) => row.count)).toEqual([12, 3, 5]);
    // The pager counts rows, not follow-ups: 3 assignees, though 18 are overdue.
    expect(result.total).toBe(3);
  });

  it('pages the assignees without disturbing the A→Z order', async () => {
    const first = await makeService(GROUPS, NAMES, {
      unassigned: 0,
      total: 18,
    }).summary(query({ page: 1, size: 2 }));
    const second = await makeService(GROUPS, NAMES, {
      unassigned: 0,
      total: 18,
    }).summary(query({ page: 2, size: 2 }));

    expect(first.rows.map((row) => row.agentName)).toEqual([
      'Alice Rahman',
      'Bilal Nasser',
    ]);
    expect(second.rows.map((row) => row.agentName)).toEqual(['Carola Vieira']);
    // Every page reports the same full row count, so the pager's length is stable.
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
  });

  it('appends the Unassigned bucket last and counts it as a row', async () => {
    const service = makeService(GROUPS, NAMES, { unassigned: 4, total: 22 });

    const result = await service.summary(query());

    expect(result.rows.at(-1)).toEqual({
      agentId: null,
      agentName: 'Unassigned',
      count: 4,
    });
    expect(result.total).toBe(4);
  });

  it('omits the Unassigned bucket when every overdue follow-up has an assignee', async () => {
    const service = makeService(GROUPS, NAMES, { unassigned: 0, total: 18 });

    const result = await service.summary(query());

    expect(result.rows.some((row) => row.agentId === null)).toBe(false);
  });

  it('returns nothing when no overdue follow-up matches the filters', async () => {
    const service = makeService([], [], { unassigned: 0, total: 0 });

    expect(await service.summary(query())).toEqual({ rows: [], total: 0 });
  });
});
