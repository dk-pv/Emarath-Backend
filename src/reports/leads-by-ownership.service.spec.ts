import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsByOwnershipReportService } from './leads-by-ownership.service';
import { LeadsByOwnershipQueryDto } from './dto/leads-by-ownership-query.dto';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';

const dec = (value: string) => new Prisma.Decimal(value);
const group = (userId: string, count: number) => ({
  userId,
  _count: { _all: count },
});

type MetricKey =
  | 'newCount'
  | 'contactedCount'
  | 'noActivityCount'
  | 'convertedCount'
  | 'lostCount';

type Counts = Record<MetricKey, number>;
const counts = (over: Partial<Counts> = {}): Counts => ({
  newCount: 0,
  contactedCount: 0,
  noActivityCount: 0,
  convertedCount: 0,
  lostCount: 0,
  ...over,
});

/**
 * Which bucket a stubbed `where` narrows to, read back off its JSON: the service builds
 * each one by ANDing a metric predicate onto the shared scoped where.
 */
function readWhere(where: unknown): {
  unassigned: boolean;
  metric: MetricKey | null;
} {
  const json = JSON.stringify(where);
  return {
    // Only the Unassigned bucket ANDs an empty `none` — noEngagementWhere's are filled.
    unassigned: json.includes('"assignments":{"none":{}}'),
    metric: json.includes('"status":"New"')
      ? 'newCount'
      : json.includes('"status":"WON"')
        ? 'convertedCount'
        : json.includes('"status":"LOST"')
          ? 'lostCount'
          : json.includes('"outcome":"ANSWERED"')
            ? 'contactedCount'
            : json.includes('"activities":{"none"')
              ? 'noActivityCount'
              : null,
  };
}

interface Options {
  /** Leads per owner, as `leadAssignment.groupBy` returns them. */
  owners?: ReturnType<typeof group>[];
  /** The distinct scoped lead count — smaller than Σ owners when leads are co-assigned. */
  total?: number;
  byUser?: Record<MetricKey, ReturnType<typeof group>[]>;
  unassigned?: number;
  unassignedMetrics?: Counts;
  unassignedValue?: Prisma.Decimal | null;
  /** The per-assignment amounts the service sums in-app. */
  values?: { userId: string; lead: { actualAmount: Prisma.Decimal | null } }[];
  names?: { id: string; name: string }[];
  agentMetrics?: Counts;
  role?: UserRole;
}

function makeService(options: Options = {}) {
  const {
    owners = [group(A, 7), group(B, 5)],
    total = 10,
    byUser = {
      newCount: [group(A, 2)],
      contactedCount: [group(A, 4)],
      noActivityCount: [group(A, 1)],
      convertedCount: [group(A, 3), group(B, 1)],
      lostCount: [group(B, 2)],
    },
    unassigned = 2,
    unassignedMetrics = counts({ newCount: 2, convertedCount: 1 }),
    unassignedValue = dec('500'),
    values = [
      { userId: A, lead: { actualAmount: dec('1500.50') } },
      { userId: A, lead: { actualAmount: null } },
      { userId: B, lead: { actualAmount: dec('2000') } },
    ],
    names = [
      { id: A, name: 'Ansar' },
      { id: B, name: 'Beth' },
    ],
    agentMetrics = counts({ convertedCount: 3 }),
    role = UserRole.SUPERADMIN,
  } = options;

  const groupBy = jest.fn((args: { where: { lead: unknown } }) => {
    const { metric } = readWhere(args.where.lead);
    return Promise.resolve(metric ? byUser[metric] : owners);
  });
  const count = jest.fn((args: { where: unknown }) => {
    const read = readWhere(args.where);
    if (read.metric)
      return Promise.resolve(
        read.unassigned
          ? unassignedMetrics[read.metric]
          : agentMetrics[read.metric],
      );
    return Promise.resolve(read.unassigned ? unassigned : total);
  });
  const aggregate = jest.fn((args: { where: unknown }) =>
    Promise.resolve({
      _sum: {
        actualAmount: readWhere(args.where).unassigned
          ? unassignedValue
          : dec('9999'),
      },
    }),
  );

  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    lead: { count, aggregate, findMany },
    leadAssignment: {
      groupBy,
      findMany: jest.fn().mockResolvedValue(values),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(names),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: AGENT_ID, name: 'Agent Zero' }),
    },
    stage: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role }),
  } as unknown as CurrentUserService;

  return {
    service: new LeadsByOwnershipReportService(prisma, currentUser),
    groupBy,
    count,
    findMany,
  };
}

const query = (
  over: Partial<LeadsByOwnershipQueryDto> = {},
): LeadsByOwnershipQueryDto => ({ page: 1, size: 25, ...over });

/** Every `where` a stubbed read was given, as JSON. */
function wheres(mock: jest.Mock): string[] {
  return (mock.mock.calls as [{ where: unknown }][]).map((call) =>
    JSON.stringify(call[0].where),
  );
}

/*
  Characterization only (ADR-0085 §B): what each ownership metric counts TODAY, so a
  Logistics-era change to the WON rule cannot move an owner's Converted column unnoticed.
  None of these states what a metric ought to become.
*/
describe('LeadsByOwnershipReportService.summary — the metrics', () => {
  it('counts an owner’s Converted Leads as status WON exactly', async () => {
    const { service, groupBy } = makeService();

    await service.summary(query());

    const asked = wheres(groupBy);
    expect(asked.some((json) => json.includes('"status":"WON"'))).toBe(true);
    // Neither the "Converted" stage nor a QC stage is part of the definition today.
    expect(asked.some((json) => json.includes('Converted'))).toBe(false);
    expect(asked.some((json) => json.includes('QC'))).toBe(false);
  });

  it('borrows every other metric from the report that owns it', async () => {
    const { service, groupBy } = makeService();

    await service.summary(query());

    const asked = wheres(groupBy).join('|');
    expect(asked).toContain('"status":"New"');
    expect(asked).toContain('"status":"LOST"');
    // Contacted = an answered call; No Activity = neither activity nor call.
    expect(asked).toContain('"outcome":"ANSWERED"');
    expect(asked).toContain('"activities":{"none"');
  });

  it('gives each owner the counts their own groups carry, and 0 for a metric they have none of', async () => {
    const { service } = makeService();

    const { rows } = await service.summary(query());

    expect(rows[0]).toMatchObject({
      ownerName: 'Ansar',
      count: 7,
      newCount: 2,
      contactedCount: 4,
      noActivityCount: 1,
      convertedCount: 3,
      lostCount: 0,
    });
    expect(rows[1]).toMatchObject({ ownerName: 'Beth', convertedCount: 1 });
  });

  it('derives conversionRatio from the owner’s own lead count', async () => {
    const { service } = makeService();

    const { rows } = await service.summary(query());

    expect(rows[0].conversionRatio).toBeCloseTo((3 / 7) * 100, 10);
    expect(rows[1].conversionRatio).toBeCloseTo((1 / 5) * 100, 10);
  });

  it('leaves qualifiedRatio and targetAchievement null — neither exists in Emarath', async () => {
    const { service } = makeService();

    const { rows } = await service.summary(query());

    expect(rows.every((row) => row.qualifiedRatio === null)).toBe(true);
    expect(rows.every((row) => row.targetAchievement === null)).toBe(true);
  });

  it('sums an owner’s lead value as a decimal string, a missing amount as zero', async () => {
    const { service } = makeService();

    const { rows } = await service.summary(query());

    // 1500.50 + (no amount) = 1500.5 — the null contributes nothing, not NaN.
    expect(rows[0].leadValue).toBe('1500.5');
    expect(rows[1].leadValue).toBe('2000');
  });
});

describe('LeadsByOwnershipReportService.summary — the rows', () => {
  it('counts a co-assigned lead under each of its owners, so rows can outnumber the total', async () => {
    const { service } = makeService();

    const { rows, total } = await service.summary(query());

    // 7 + 5 = 12 owner-rows over 10 distinct leads: two leads carry two owners each.
    expect(rows[0].count + rows[1].count).toBe(12);
    expect(total).toBe(10);
  });

  it('appends Unassigned last, with its own metrics and value', async () => {
    const { service } = makeService();

    const { rows } = await service.summary(query());

    expect(rows.at(-1)).toMatchObject({
      ownerId: null,
      ownerName: 'Unassigned',
      count: 2,
      newCount: 2,
      convertedCount: 1,
      leadValue: '500',
    });
  });

  it('omits the Unassigned bucket when every lead has an owner', async () => {
    const { service } = makeService({ unassigned: 0 });

    const { rows } = await service.summary(query());

    expect(rows.some((row) => row.ownerId === null)).toBe(false);
  });

  it('ranks by lead count, then by name, and calls an unnamed owner Unknown', async () => {
    const { service } = makeService({
      owners: [group(B, 5), group(A, 5)],
      names: [{ id: A, name: 'Ansar' }],
      unassigned: 0,
    });

    const { rows } = await service.summary(query());

    // Equal counts fall back to the name; B has no user row, so it reads Unknown.
    expect(rows.map((row) => row.ownerName)).toEqual(['Ansar', 'Unknown']);
  });

  it('keeps archived leads out of every bucket, through the shared lead scope', async () => {
    const { service, groupBy, count } = makeService();

    await service.summary(query());

    expect(
      [...wheres(groupBy), ...wheres(count)].every((json) =>
        json.includes('"deletedAt":null'),
      ),
    ).toBe(true);
  });
});

describe('LeadsByOwnershipReportService — the shared filters', () => {
  it('matches a team through the assignee’s own team', async () => {
    const { service, count } = makeService();

    await service.summary(query({ team: ['Alpha', 'Beta'] }));

    expect(wheres(count)[0]).toContain('"team":{"in":["Alpha","Beta"]}');
  });

  it('threads source and agent into the same scoped query', async () => {
    const { service, count } = makeService();

    await service.summary(query({ source: ['Walk-in'], agent: ['u-1'] }));

    const json = wheres(count)[0];
    expect(json).toContain('"source":{"in":["Walk-in"]}');
    expect(json).toContain('"userId":{"in":["u-1"]}');
  });

  it('reads the period off createdAt, as a half-open window', async () => {
    const { service, count } = makeService();

    await service.summary(
      query({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    );

    expect(wheres(count)[0]).toContain(
      '"createdAt":{"gte":"2026-09-01T00:00:00.000Z","lt":"2026-10-01T00:00:00.000Z"}',
    );
  });

  it('returns an empty summary when no lead matches at all', async () => {
    const { service } = makeService({ owners: [], unassigned: 0, total: 0 });

    await expect(service.summary(query())).resolves.toEqual({
      rows: [],
      total: 0,
    });
  });

  it('pages the detailed view newest first, counting the same query it pages', async () => {
    const { service, findMany, count } = makeService();

    const detailed = await service.listDetailed(query({ page: 2, size: 25 }));

    const [page] = findMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown; skip: number; take: number },
    ];
    const [tally] = count.mock.calls[0] as [{ where: unknown }];
    expect(page.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    expect(page.skip).toBe(25);
    expect(page.take).toBe(25);
    expect(tally.where).toBe(page.where);
    expect(detailed.total).toBe(10);
  });
});

describe('LeadsByOwnershipReportService.summary — a sales agent', () => {
  it('gets one row, their own scoped set, without naming a co-owner', async () => {
    const { service, groupBy } = makeService({ role: UserRole.SALES_AGENT });

    const { rows, total } = await service.summary(query());

    expect(groupBy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ownerId: AGENT_ID,
      ownerName: 'Agent Zero',
      count: 10,
      convertedCount: 3,
    });
    expect(total).toBe(10);
  });

  it('gets no row at all when nothing in the period is theirs', async () => {
    const { service } = makeService({ role: UserRole.SALES_AGENT, total: 0 });

    await expect(service.summary(query())).resolves.toEqual({
      rows: [],
      total: 0,
    });
  });
});
