import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsBySourceReportService } from './leads-by-source.service';
import { LeadsBySourceQueryDto } from './dto/leads-by-source-query.dto';

const AGENT_ID = 'agent-1';

/** One bucket, as `lead.groupBy({ by: ['source'] })` returns it. */
const group = (source: string | null, count: number) => ({
  source,
  _count: { _all: count },
});

interface Options {
  all?: ReturnType<typeof group>[];
  converted?: ReturnType<typeof group>[];
  role?: UserRole;
}

function makeService(options: Options = {}) {
  const {
    all = [
      group('DoubleTick', 5),
      group('Walk-in', 3),
      group(null, 2),
      group('   ', 1),
    ],
    converted = [group('DoubleTick', 2), group(null, 1)],
    role = UserRole.SUPERADMIN,
  } = options;

  const groupBy = jest.fn((args: { where: unknown }) =>
    Promise.resolve(
      JSON.stringify(args.where).includes('"status":"WON"') ? converted : all,
    ),
  );

  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(11);
  const prisma = {
    lead: { groupBy, findMany, count },
    stage: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role }),
  } as unknown as CurrentUserService;

  return {
    service: new LeadsBySourceReportService(prisma, currentUser),
    groupBy,
    findMany,
    count,
  };
}

const query = (
  over: Partial<LeadsBySourceQueryDto> = {},
): LeadsBySourceQueryDto => ({ page: 1, size: 25, ...over });

/** Every `where` a stubbed read was given, as JSON. */
function wheres(mock: jest.Mock): string[] {
  return (mock.mock.calls as [{ where: unknown }][]).map((call) =>
    JSON.stringify(call[0].where),
  );
}

/*
  Characterization only (ADR-0085 §B): what a source's conversion rate counts TODAY, so a
  Logistics-era change to the WON rule cannot move it unnoticed. None of these states what
  the metric ought to become.
*/
describe('LeadsBySourceReportService.summary', () => {
  it('counts a bucket’s conversions as status WON exactly', async () => {
    const { service, groupBy } = makeService();

    await service.summary(query());

    const asked = wheres(groupBy);
    expect(asked).toHaveLength(2);
    expect(
      asked.filter((json) => json.includes('"status":"WON"')),
    ).toHaveLength(1);
    // Neither the "Converted" stage nor a QC stage is part of the definition today.
    expect(asked.some((json) => json.includes('Converted'))).toBe(false);
    expect(asked.some((json) => json.includes('QC'))).toBe(false);
  });

  it('folds null and blank sources into one No Source bucket', async () => {
    const { service } = makeService();

    const { rows, total } = await service.summary(query());

    // Two database groups (null, "   ") become one row of 3.
    expect(rows.find((row) => row.source === 'No Source')?.count).toBe(3);
    expect(rows).toHaveLength(3);
    expect(total).toBe(11);
  });

  it('shares are of the filtered total, and sum to 100', async () => {
    const { service } = makeService();

    const { rows } = await service.summary(query());

    expect(rows.find((row) => row.source === 'DoubleTick')?.share).toBeCloseTo(
      (5 / 11) * 100,
      10,
    );
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(100, 10);
  });

  it('rates conversion per bucket, and 0 for a bucket that converted nothing', async () => {
    const { service } = makeService();

    const { rows } = await service.summary(query());

    expect(
      rows.find((row) => row.source === 'DoubleTick')?.conversionRate,
    ).toBe(40);
    expect(rows.find((row) => row.source === 'Walk-in')?.conversionRate).toBe(
      0,
    );
    // The folded bucket rates against its folded count: 1 of 3.
    expect(
      rows.find((row) => row.source === 'No Source')?.conversionRate,
    ).toBeCloseTo((1 / 3) * 100, 10);
  });

  it('orders sources alphabetically, ignoring case, with No Source last', async () => {
    const { service } = makeService({
      all: [
        group('zeta', 1),
        group(null, 1),
        group('Alpha', 1),
        group('beta', 1),
      ],
      converted: [],
    });

    const { rows } = await service.summary(query());

    expect(rows.map((row) => row.source)).toEqual([
      'Alpha',
      'beta',
      'zeta',
      'No Source',
    ]);
  });

  it('keeps archived leads out and holds a sales agent to their own leads', async () => {
    const { service, groupBy } = makeService({ role: UserRole.SALES_AGENT });

    await service.summary(query());

    expect(
      wheres(groupBy).every(
        (json) =>
          json.includes('"deletedAt":null') &&
          json.includes('"userId":"agent-1"'),
      ),
    ).toBe(true);
  });

  it('returns nothing, not a divide by zero, when no lead matches', async () => {
    const { service } = makeService({ all: [], converted: [] });

    await expect(service.summary(query())).resolves.toEqual({
      rows: [],
      total: 0,
    });
  });
});

describe('LeadsBySourceReportService — the shared filters', () => {
  it('matches a team through the assignee’s own team, in both groupings', async () => {
    const { service, groupBy } = makeService();

    await service.summary(query({ team: ['Alpha'] }));

    expect(
      wheres(groupBy).every((json) => json.includes('"team":{"in":["Alpha"]}')),
    ).toBe(true);
  });

  it('narrows to the chosen sources before grouping by source', async () => {
    const { service, groupBy } = makeService();

    await service.summary(query({ source: ['Walk-in'], agent: ['u-1'] }));

    const json = wheres(groupBy)[0];
    expect(json).toContain('"source":{"in":["Walk-in"]}');
    expect(json).toContain('"userId":{"in":["u-1"]}');
  });

  it('reads the period off createdAt, as a half-open window', async () => {
    const { service, groupBy } = makeService();

    await service.summary(
      query({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    );

    expect(wheres(groupBy)[0]).toContain(
      '"createdAt":{"gte":"2026-09-01T00:00:00.000Z","lt":"2026-10-01T00:00:00.000Z"}',
    );
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
    expect(detailed.total).toBe(11);
  });
});
