import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { HotLeadsQueryDto } from './dto/hot-leads-query.dto';
import { HotLeadsService } from './hot-leads.service';

const AGENT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CALLER = '22222222-2222-2222-2222-222222222222';

const dec = (n: string) => new Prisma.Decimal(n);

const assignment = (id: string, name: string) => ({ user: { id, name } });

/** Five hot leads, already in the service's own order (value desc, nulls last). */
const LEADS = [
  {
    id: 'lead-1',
    name: 'Al Noor Trading',
    actualAmount: dec('9000.50'),
    assignments: [assignment(AGENT_A, 'Ansar')],
  },
  {
    id: 'lead-2',
    name: 'Gulf Interiors',
    actualAmount: dec('4200'),
    assignments: [assignment(AGENT_A, 'Ansar'), assignment(AGENT_B, 'Beth')],
  },
  {
    id: 'lead-3',
    name: 'Marina Fitout',
    actualAmount: dec('1300.25'),
    assignments: [assignment(AGENT_B, 'Beth')],
  },
  {
    id: 'lead-4',
    name: 'Desert Logistics',
    actualAmount: dec('500'),
    assignments: [],
  },
  {
    id: 'lead-5',
    name: 'Palm Services',
    actualAmount: null,
    assignments: [assignment(AGENT_B, 'Beth')],
  },
];

/** Σ over every fixture — what the aggregate answers regardless of the page asked for. */
const ALL_VALUE = LEADS.reduce(
  (sum, lead) => sum.add(lead.actualAmount ?? new Prisma.Decimal(0)),
  new Prisma.Decimal(0),
);

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const findMany = jest.fn((args: { skip?: number; take?: number }) =>
    LEADS.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? LEADS.length)),
  );
  const count = jest.fn(() => LEADS.length);
  // Deliberately blind to skip/take: an aggregate over the same `where` is what makes
  // the running total describe every page, and the test relies on that being true.
  const aggregate = jest.fn(
    (): { _sum: { actualAmount: Prisma.Decimal | null } } => ({
      _sum: { actualAmount: ALL_VALUE },
    }),
  );

  const prisma = {
    lead: { findMany, count, aggregate },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: AGENT_A, avatarKey: 'avatars/ansar.png' },
        { id: AGENT_B, avatarKey: null },
      ]),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: CALLER, role }),
  } as unknown as CurrentUserService;
  const storage = {
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/ansar'),
  } as unknown as StorageService;

  return {
    service: new HotLeadsService(prisma, currentUser, storage),
    prisma,
    findMany,
    count,
    aggregate,
  };
}

const query = (over: Partial<HotLeadsQueryDto> = {}): HotLeadsQueryDto => ({
  page: 1,
  size: 100,
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('HotLeadsService.getHotLeads', () => {
  it('selects only HOT and SUPER HOT, through the KPI counter’s own fragment', async () => {
    const { service, findMany } = makeService();
    await service.getHotLeads(query());

    const where = JSON.stringify(findMany.mock.calls[0][0]);
    expect(where).toContain('SUPER HOT');
    expect(where).toContain('"HOT"');
  });

  it('ranks by Lead Value descending, valueless leads last, ties broken by id (AC1)', async () => {
    const { service, findMany } = makeService();
    await service.getHotLeads(query());

    expect((findMany.mock.calls[0][0] as { orderBy: unknown }).orderBy).toEqual(
      [{ actualAmount: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
    );
  });

  it('returns the agent, a signed avatar URL, and value as a decimal string', async () => {
    const { service } = makeService();
    const { rows } = await service.getHotLeads(query());

    expect(rows[0]).toEqual({
      leadId: 'lead-1',
      leadName: 'Al Noor Trading',
      assignedAgents: [
        {
          agentId: AGENT_A,
          agentName: 'Ansar',
          avatarUrl: 'https://signed/ansar',
        },
      ],
      value: '9000.5',
    });
    // A member with no photo gets null, never an invented URL.
    expect(rows[2].assignedAgents[0].avatarUrl).toBeNull();
    // A lead with no amount dashes in the table; it is not a zero-value lead.
    expect(rows[4].value).toBeNull();
  });

  it('runs the page, the count and the running total in one transaction', async () => {
    const { service, prisma } = makeService();
    await service.getHotLeads(query());

    const [operations] = (prisma.$transaction as jest.Mock).mock.calls[0] as [
      unknown[],
    ];
    expect(operations).toHaveLength(3);
  });

  it('keeps the running total across ALL pages — paging cannot change it (AC3)', async () => {
    const { service, aggregate } = makeService();

    const first = await service.getHotLeads(query({ page: 1, size: 2 }));
    const second = await service.getHotLeads(query({ page: 2, size: 2 }));
    const third = await service.getHotLeads(query({ page: 3, size: 2 }));

    expect(first.rows.map((row) => row.leadId)).toEqual(['lead-1', 'lead-2']);
    expect(second.rows.map((row) => row.leadId)).toEqual(['lead-3', 'lead-4']);
    expect(third.rows.map((row) => row.leadId)).toEqual(['lead-5']);

    // 9000.50 + 4200 + 1300.25 + 500, the same on every page — never the page's own sum.
    expect(first.totalValue).toBe('15000.75');
    expect(second.totalValue).toBe(first.totalValue);
    expect(third.totalValue).toBe(first.totalValue);
    expect(first.total).toBe(5);

    // The proof it cannot drift: the aggregate is never given a page window.
    for (const [args] of aggregate.mock.calls as unknown as [
      Record<string, unknown>,
    ][]) {
      expect(args).not.toHaveProperty('skip');
      expect(args).not.toHaveProperty('take');
    }
  });

  it('totals zero rather than throwing when the period holds no hot leads', async () => {
    const { service, aggregate } = makeService();
    aggregate.mockReturnValueOnce({ _sum: { actualAmount: null } });

    await expect(service.getHotLeads(query())).resolves.toMatchObject({
      totalValue: '0',
    });
  });

  it('scopes every read to the caller for a sales agent — page, count and total', async () => {
    const { service, findMany, count, aggregate } = makeService(
      UserRole.SALES_AGENT,
    );
    await service.getHotLeads(query());

    for (const mock of [findMany, count, aggregate]) {
      const { where } = mock.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(where)).toContain(CALLER);
    }
  });
});
