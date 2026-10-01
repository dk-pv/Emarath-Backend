import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { LeadsAttentionQueryDto } from './dto/leads-attention-query.dto';
import { LeadsAttentionService } from './leads-attention.service';

const AGENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CALLER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const LEADS = [
  {
    id: 'lead-1',
    name: 'Al Noor Trading',
    createdAt: new Date('2026-09-20T06:30:00.000Z'),
    assignments: [
      { user: { id: AGENT_A, name: 'Ansar' } },
      { user: { id: AGENT_B, name: 'Beth' } },
    ],
  },
  {
    id: 'lead-2',
    name: 'Gulf Interiors',
    createdAt: new Date('2026-09-18T11:00:00.000Z'),
    assignments: [],
  },
];

/**
 * Prisma stubbed at the edge: every count answers from `counts` in call order
 * (overdue, noActivity, lost, then the selected group's total), and the page is the
 * fixture sliced by skip/take. The `where` each read received is what the tests read.
 */
function makeService(
  role: UserRole = UserRole.SUPERADMIN,
  team: string | null = null,
) {
  const counts = [7, 3, 2, 3];
  const count = jest.fn(() => counts.shift());
  const findMany = jest.fn((args: { skip?: number; take?: number }) =>
    LEADS.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? LEADS.length)),
  );
  const $transaction = jest.fn((operations: unknown[]) =>
    Promise.all(operations),
  );

  const prisma = {
    lead: { count, findMany },
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
  const storage = {
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/ansar'),
  } as unknown as StorageService;

  return {
    service: new LeadsAttentionService(prisma, currentUser, storage),
    count,
    findMany,
    $transaction,
  };
}

const query = (
  over: Partial<LeadsAttentionQueryDto> = {},
): LeadsAttentionQueryDto => ({
  todayStart: '2026-09-24T18:30:00.000Z',
  from: '2026-08-31T18:30:00.000Z',
  to: '2026-09-30T18:30:00.000Z',
  group: 'overdue',
  page: 1,
  size: 100,
  ...over,
});

/** The `where` of the nth count: 0 overdue, 1 noActivity, 2 lost, 3 selected. */
const countWhere = (count: jest.Mock, index: number): string =>
  JSON.stringify((count.mock.calls[index] as [{ where: unknown }])[0].where);

describe('LeadsAttentionService.getLeadsAttention — the three groups', () => {
  it('returns all three counts, the selected page and its total from one transaction', async () => {
    const { service, $transaction } = makeService();

    const result = await service.getLeadsAttention(query());

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(result.counts).toEqual({ overdue: 7, noActivity: 3, lost: 2 });
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.leadId)).toEqual(['lead-1', 'lead-2']);
  });

  it('Overdue: leads carrying an activity overdue as of the caller’s today', async () => {
    const { service, count } = makeService();
    await service.getLeadsAttention(query());

    const where = countWhere(count, 0);
    expect(where).toContain('"activities":{"some"');
    expect(where).toContain('2026-09-24T18:30:00.000Z');
  });

  it('No Activity: leads created in the period with no engagement', async () => {
    const { service, count } = makeService();
    await service.getLeadsAttention(query());

    const where = countWhere(count, 1);
    expect(where).toContain('"createdAt":{"gte":"2026-08-31T18:30:00.000Z"');
    expect(where).toContain('"lt":"2026-09-30T18:30:00.000Z"');
  });

  it('Lost: status LOST, created in the period', async () => {
    const { service, count } = makeService();
    await service.getLeadsAttention(query());

    const where = countWhere(count, 2);
    expect(where).toContain('"LOST"');
    expect(where).toContain('"createdAt":{"gte":"2026-08-31T18:30:00.000Z"');
  });

  it.each(['overdue', 'noActivity', 'lost'] as const)(
    'the %s page reads exactly the where its own card counts',
    async (group) => {
      const { service, count, findMany } = makeService();
      await service.getLeadsAttention(query({ group }));

      const index = { overdue: 0, noActivity: 1, lost: 2 }[group];
      const page = (findMany.mock.calls[0] as [{ where: unknown }])[0].where;
      expect(JSON.stringify(page)).toBe(countWhere(count, index));
      expect(countWhere(count, 3)).toBe(countWhere(count, index));
    },
  );
});

describe('LeadsAttentionService.getLeadsAttention — paging and rows', () => {
  it('pages in the query, newest first with id breaking ties', async () => {
    const { service, findMany } = makeService();
    await service.getLeadsAttention(query({ page: 3, size: 25 }));

    expect(findMany.mock.calls[0][0]).toMatchObject({
      skip: 50,
      take: 25,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  });

  it('dates each row by the lead’s own creation instant, as ISO', async () => {
    const { service } = makeService();
    const { rows } = await service.getLeadsAttention(query());

    expect(rows[0].leadDateTime).toBe('2026-09-20T06:30:00.000Z');
  });

  it('lists every assignee, a signed photo where one exists and null where not', async () => {
    const { service } = makeService();
    const { rows } = await service.getLeadsAttention(query());

    expect(rows[0].assignedAgents).toEqual([
      {
        agentId: AGENT_A,
        agentName: 'Ansar',
        avatarUrl: 'https://signed/ansar',
      },
      { agentId: AGENT_B, agentName: 'Beth', avatarUrl: null },
    ]);
    expect(rows[1].assignedAgents).toEqual([]);
  });
});

describe('LeadsAttentionService.getLeadsAttention — role scope, in the query', () => {
  it('pins a sales agent to leads assigned to them, in every group', async () => {
    const { service, count } = makeService(UserRole.SALES_AGENT);
    await service.getLeadsAttention(query());

    for (const index of [0, 1, 2, 3]) {
      expect(countWhere(count, index)).toContain(`"userId":"${CALLER}"`);
    }
  });

  it('narrows a sales manager to their team', async () => {
    const { service, count } = makeService(UserRole.SALES_MANAGER, 'North');
    await service.getLeadsAttention(query());

    for (const index of [0, 1, 2]) {
      expect(countWhere(count, index)).toContain('"team":"North"');
    }
  });

  it('lets the organisation-wide roles through without an owner predicate', async () => {
    const { service, count } = makeService(UserRole.SUPERADMIN);
    await service.getLeadsAttention(query());

    expect(countWhere(count, 2)).not.toContain('"userId"');
  });

  it.each([
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.ACCOUNTS_EXECUTIVE,
  ])('matches no lead at all for %s', async (role) => {
    const { service, count } = makeService(role);
    await service.getLeadsAttention(query());

    for (const index of [0, 1, 2]) {
      expect(countWhere(count, index)).toContain('"id":{"in":[]}');
    }
  });
});
