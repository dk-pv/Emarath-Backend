import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import type { ActivitiesTrackerQueryDto } from './dto/activities-tracker-query.dto';
import { ActivitiesTrackerService } from './activities-tracker.service';

// The worklist row mapper needs a full lead record; its own contract is tested with
// the Activities module. Here only its input and the rows' order matter.
jest.mock('../activities/dto/activity-response.dto', () => ({
  ...jest.requireActual<object>('../activities/dto/activity-response.dto'),
  toActivityListItem: (row: { id: string }) => ({ id: row.id }),
}));

const AGENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CALLER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ROWS = [
  {
    id: 'act-1',
    assignees: [
      { user: { id: AGENT_A, name: 'Ansar' } },
      { user: { id: AGENT_B, name: 'Beth' } },
    ],
  },
  { id: 'act-2', assignees: [{ user: { id: AGENT_A, name: 'Ansar' } }] },
];

interface Options {
  role?: UserRole;
  team?: string | null;
  /** What Settings → Activity reminders answers; `null` makes the read fail. */
  general?: { overdueMode: string; overdueAfterMinutes: number } | null;
}

/**
 * Counts answer in call order — overdue, today, tomorrow, this month, then the
 * selected group's total — and the page is the fixture. The `where` each read
 * received is what the tests read.
 */
function makeService({
  role = UserRole.SUPERADMIN,
  team = null,
  general = { overdueMode: 'END_OF_DAY', overdueAfterMinutes: 0 },
}: Options = {}) {
  const counts = [4, 2, 1, 9, 4];
  const count = jest.fn(() => counts.shift());
  const findMany = jest.fn<typeof ROWS, [unknown]>(() => ROWS);
  const $transaction = jest.fn((operations: unknown[]) =>
    Promise.all(operations),
  );

  const prisma = {
    activity: { count, findMany },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: AGENT_A, avatarKey: 'avatars/ansar.png' },
        { id: AGENT_B, avatarKey: null },
      ]),
    },
    $transaction,
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: CALLER, role, team }),
  } as unknown as CurrentUserService;
  const settings = {
    getActivityGeneral:
      general === null
        ? jest.fn().mockRejectedValue(new Error('settings unavailable'))
        : jest.fn().mockResolvedValue(general),
  } as unknown as SettingsService;
  const storage = {
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/ansar'),
  } as unknown as StorageService;

  return {
    service: new ActivitiesTrackerService(
      prisma,
      currentUser,
      settings,
      storage,
    ),
    count,
    findMany,
    $transaction,
  };
}

const query = (
  over: Partial<ActivitiesTrackerQueryDto> = {},
): ActivitiesTrackerQueryDto => ({
  group: 'overdue',
  todayStart: '2026-09-23T18:30:00.000Z',
  todayEnd: '2026-09-24T18:30:00.000Z',
  tomorrowEnd: '2026-09-25T18:30:00.000Z',
  monthStart: '2026-08-31T18:30:00.000Z',
  monthEnd: '2026-09-30T18:30:00.000Z',
  page: 1,
  size: 100,
  ...over,
});

const GROUP_INDEX = { overdue: 0, today: 1, tomorrow: 2, thisMonth: 3 };

/** The `where` of the nth count: 0 overdue, 1 today, 2 tomorrow, 3 this month, 4 selected. */
const countWhere = (count: jest.Mock, index: number): string =>
  JSON.stringify((count.mock.calls[index] as [{ where: unknown }])[0].where);

describe('ActivitiesTrackerService.getActivities — the four cards', () => {
  it('returns all four counts, the selected page and its total from one transaction', async () => {
    const { service, $transaction } = makeService();

    const result = await service.getActivities(query());

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(result.counts).toEqual({
      overdue: 4,
      today: 2,
      tomorrow: 1,
      thisMonth: 9,
    });
    expect(result.total).toBe(4);
    expect(result.rows).toEqual([{ id: 'act-1' }, { id: 'act-2' }]);
  });

  it('Overdue: open follow-ups due before the start of today under the End-of-day rule', async () => {
    const { service, count } = makeService();
    await service.getActivities(query());

    const where = countWhere(count, 0);
    expect(where).toContain('"completedAt":null');
    expect(where).toContain('"dueAt":{"lt":"2026-09-23T18:30:00.000Z"}');
  });

  it('Overdue follows the configured custom time span, not midnight', async () => {
    const before = Date.now();
    const { service, count } = makeService({
      general: { overdueMode: 'CUSTOM_TIME_SPAN', overdueAfterMinutes: 30 },
    });
    await service.getActivities(query());

    const where = JSON.parse(countWhere(count, 0)) as {
      AND: [unknown, { dueAt: { lt: string } }];
    };
    const cutoff = new Date(where.AND[1].dueAt.lt).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 30 * 60_000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 30 * 60_000);
  });

  it('falls back to the End-of-day rule when the settings cannot be read', async () => {
    const { service, count } = makeService({ general: null });
    await service.getActivities(query());

    expect(countWhere(count, 0)).toContain(
      '"dueAt":{"lt":"2026-09-23T18:30:00.000Z"}',
    );
  });

  it('Today and Tomorrow: open follow-ups due inside each day', async () => {
    const { service, count } = makeService();
    await service.getActivities(query());

    expect(countWhere(count, 1)).toContain(
      '"dueAt":{"gte":"2026-09-23T18:30:00.000Z","lt":"2026-09-24T18:30:00.000Z"}',
    );
    expect(countWhere(count, 2)).toContain(
      '"dueAt":{"gte":"2026-09-24T18:30:00.000Z","lt":"2026-09-25T18:30:00.000Z"}',
    );
  });

  it('This Month: everything due in the month, open or completed', async () => {
    const { service, count } = makeService();
    await service.getActivities(query());

    const where = countWhere(count, 3);
    expect(where).toContain('2026-08-31T18:30:00.000Z');
    expect(where).toContain('2026-09-30T18:30:00.000Z');
    expect(where).not.toContain('"completedAt"');
  });

  it.each(['overdue', 'today', 'tomorrow', 'thisMonth'] as const)(
    'the %s page reads exactly the where its own card counts',
    async (group) => {
      const { service, count, findMany } = makeService();
      await service.getActivities(query({ group }));

      const page = (findMany.mock.calls[0] as [{ where: unknown }])[0].where;
      expect(JSON.stringify(page)).toBe(countWhere(count, GROUP_INDEX[group]));
      expect(countWhere(count, 4)).toBe(countWhere(count, GROUP_INDEX[group]));
    },
  );
});

describe('ActivitiesTrackerService.getActivities — paging and photos', () => {
  it('pages in the query, soonest due first with id breaking ties', async () => {
    const { service, findMany } = makeService();
    await service.getActivities(query({ page: 2, size: 10 }));

    expect(findMany.mock.calls[0][0]).toMatchObject({
      skip: 10,
      take: 10,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('signs one photo per assignee on the page, null where there is none', async () => {
    const { service } = makeService();
    const { avatars } = await service.getActivities(query());

    expect(avatars).toEqual({
      [AGENT_A]: 'https://signed/ansar',
      [AGENT_B]: null,
    });
  });
});

describe('ActivitiesTrackerService.getActivities — role scope, in the query', () => {
  it('pins a sales agent to follow-ups assigned to them, in every read', async () => {
    const { service, count, findMany } = makeService({
      role: UserRole.SALES_AGENT,
    });
    await service.getActivities(query());

    for (const index of [0, 1, 2, 3, 4]) {
      expect(countWhere(count, index)).toContain(`"userId":"${CALLER}"`);
    }
    expect(JSON.stringify(findMany.mock.calls[0][0])).toContain(
      `"userId":"${CALLER}"`,
    );
  });

  it('narrows a sales manager to their team', async () => {
    const { service, count } = makeService({
      role: UserRole.SALES_MANAGER,
      team: 'North',
    });
    await service.getActivities(query());

    for (const index of [0, 1, 2, 3]) {
      expect(countWhere(count, index)).toContain('"team":"North"');
    }
  });

  it('never counts a deleted follow-up, whatever the role', async () => {
    const { service, count } = makeService();
    await service.getActivities(query());

    for (const index of [0, 1, 2, 3]) {
      expect(countWhere(count, index)).toContain('"deletedAt":null');
    }
  });

  it.each([
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.ACCOUNTS_EXECUTIVE,
  ])('matches no follow-up at all for %s', async (role) => {
    const { service, count } = makeService({ role });
    await service.getActivities(query());

    for (const index of [0, 1, 2, 3]) {
      expect(countWhere(count, index)).toContain('"id":{"in":[]}');
    }
  });
});
