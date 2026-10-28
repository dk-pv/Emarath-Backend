import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import { MAX_DEALS, RevenueReportService } from './revenue.service';

const dec = (value: string | number) => new Prisma.Decimal(value);
const AGENT = '00000000-0000-4000-8000-00000000000a';

// This quarter and the one before, as a UTC+4 browser resolves them.
const PERIOD = {
  from: '2026-09-30T20:00:00.000Z',
  to: '2026-12-31T20:00:00.000Z',
};
const PRIOR = {
  priorFrom: '2026-06-30T20:00:00.000Z',
  priorTo: '2026-09-30T20:00:00.000Z',
};
const EDGES = [
  '2026-09-30T20:00:00.000Z',
  '2026-10-31T20:00:00.000Z',
  '2026-11-30T20:00:00.000Z',
  '2026-12-31T20:00:00.000Z',
];

const query = (overrides: Partial<RevenueQueryDto> = {}): RevenueQueryDto =>
  Object.assign(new RevenueQueryDto(), overrides);

const json = (value: unknown) => JSON.stringify(value);
const group = (
  key: string,
  value: string | null,
  count: number,
  sum?: number,
) => ({
  [key]: value,
  _count: { _all: count },
  _sum: { actualAmount: sum === undefined ? null : dec(sum) },
});

/** A row shaped like CONVERTED_LIST_SELECT — enough for toLeadListItem to run. */
function listRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Lead ${id.slice(-2)}`,
    firstName: null,
    primaryPhone: '900',
    secondaryPhone: null,
    email: null,
    language: null,
    country: null,
    source: null,
    status: 'WON',
    pipeline: 'Lead Pipeline',
    category: null,
    actualAmount: dec(100),
    forecastedAmount: null,
    bookingDate: null,
    callStatus: null,
    callAttempts: 0,
    whatsappAttempts: 0,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-10T09:00:00.000Z'),
    statusChangedAt: new Date('2026-10-10T09:00:00.000Z'),
    state: null,
    street: null,
    city: null,
    product: null,
    productQty: null,
    product2: null,
    product2Qty: null,
    paymentMethod: null,
    nationalCode: null,
    duplicateOfId: null,
    logisticsOrder: null,
    complaints: [],
    assignments: [],
    tags: [],
    customFieldValues: [],
    _count: { activities: 0, calls: 0 },
    ...overrides,
  };
}

const id = (n: number) =>
  `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const groupBy = jest.fn((args: { by: string[]; where: unknown }) => {
    const where = json(args.where);
    if (args.by[0] === 'pipeline') {
      return Promise.resolve(
        where.includes('"LOST"')
          ? [group('pipeline', 'Lead Pipeline', 3)]
          : [group('pipeline', 'Lead Pipeline', 7, 550)],
      );
    }
    if (where.includes('"createdAt"')) {
      return Promise.resolve(
        where.includes('"WON"')
          ? [group('source', 'DoubleTick', 4)]
          : [group('source', 'DoubleTick', 20), group('source', null, 5)],
      );
    }
    return Promise.resolve(
      where.includes(PRIOR.priorFrom)
        ? [group('source', 'DoubleTick', 2, 200)]
        : [
            group('source', 'DoubleTick', 5, 500),
            group('source', null, 1),
            group('source', '', 1, 50),
          ],
    );
  });
  const count = jest.fn((args: { where: unknown }) =>
    Promise.resolve(json(args.where).includes('"WON"') ? 1 : 10),
  );
  const aggregate = jest
    .fn()
    .mockResolvedValue({ _count: 2, _sum: { actualAmount: dec(100) } });
  const userAggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { monthlyGoalAmount: dec(1000) } });

  const lines = [
    { ...listRow(id(1)), actualAmount: dec(99), source: 'Broadcast' },
    { ...listRow(id(2)), actualAmount: dec(1000), source: 'DoubleTick' },
    { ...listRow(id(3)), actualAmount: dec(145), source: 'DoubleTick' },
  ];
  const findMany = jest.fn((args: { where: unknown; take?: number }) => {
    if (args.take !== undefined) return Promise.resolve(lines);
    // The page read: the ids it asks for, in any order.
    const wanted = (json(args.where).match(/0000000000\d\d/g) ?? []).map(
      (tail) => `00000000-0000-4000-8000-${tail}`,
    );
    return Promise.resolve(
      lines.filter((row) => wanted.includes(row.id)).reverse(),
    );
  });
  const assignmentFindMany = jest.fn().mockResolvedValue([
    {
      leadId: id(1),
      user: { name: 'NIHAD V P', role: UserRole.SALES_AGENT, orgRole: null },
    },
    {
      leadId: id(3),
      user: {
        name: 'Ansar UAE',
        role: UserRole.SALES_MANAGER,
        orgRole: { name: 'Sales Manager' },
      },
    },
  ]);
  const stageFindFirst = jest.fn().mockResolvedValue({ color: 'lime' });

  const prisma = {
    lead: { groupBy, count, aggregate, findMany },
    user: { aggregate: userAggregate },
    leadAssignment: { findMany: assignmentFindMany },
    stage: { findFirst: stageFindFirst },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role, team: null }),
  } as unknown as CurrentUserService;
  return {
    service: new RevenueReportService(prisma, currentUser),
    groupBy,
    count,
    aggregate,
    userAggregate,
    findMany,
    assignmentFindMany,
  };
}

const calls = (mock: jest.Mock) =>
  (mock.mock.calls as [{ where: unknown }][]).map(([args]) => json(args.where));

describe('RevenueReportService.overview', () => {
  it('counts the deals that became WON in the period, inside the caller’s scope', async () => {
    const { service, groupBy } = makeService(UserRole.SALES_AGENT);
    await service.overview(query({ ...PERIOD }));

    const deals = calls(groupBy)[0];
    expect(deals).toContain('"status":"WON"');
    expect(deals).toContain(
      `"statusChangedAt":{"gte":"${PERIOD.from}","lt":"${PERIOD.to}"}`,
    );
    expect(deals).not.toContain('"createdAt"');
    // An agent's scope: only leads assigned to them.
    expect(deals).toContain('"userId":"u1"');
  });

  it('applies the toolbar’s agent, pipeline and Filter conditions to every figure', async () => {
    const { service, groupBy, count, aggregate, userAggregate } = makeService();
    await service.overview(
      query({
        ...PERIOD,
        ...PRIOR,
        edge: EDGES,
        agent: [AGENT],
        pipeline: 'Complaints',
        conditions: JSON.stringify([
          { field: 'source', operator: 'is', values: ['Broadcast'] },
        ]),
      }),
    );

    for (const where of [
      ...calls(groupBy),
      ...calls(count),
      ...calls(aggregate),
    ]) {
      expect(where).toContain(AGENT);
      expect(where).toContain('"pipeline":"Complaints"');
      expect(where).toContain('Broadcast');
    }
    // The target is the selected agent's goal, within the caller's members.
    expect(json((userAggregate.mock.calls as unknown[][])[0][0])).toContain(
      `"id":{"in":["${AGENT}"]}`,
    );
  });

  it('assembles the KPIs, the comparison, the target, the trend and both breakdowns', async () => {
    const { service, aggregate } = makeService();
    const result = await service.overview(
      query({ ...PERIOD, ...PRIOR, edge: EDGES, targetMonths: 3 }),
    );

    // 7 deals for 550 (one without an amount); 4 of the 25 leads created are WON.
    expect(result.current).toEqual({
      revenue: '550.00',
      deals: 7,
      avgDealValue: '78.57',
      conversionRate: 16,
    });
    expect(result.prior).toEqual({
      revenue: '200.00',
      deals: 2,
      avgDealValue: '100.00',
      conversionRate: 10,
    });
    expect(result.change).toEqual({
      revenue: 175,
      deals: 250,
      avgDealValue: -21.43,
      conversionRate: 60,
    });
    expect(result.target).toEqual({
      monthly: '1000.00',
      months: 3,
      period: '3000.00',
      percent: 18.33,
    });

    expect(result.trend).toEqual(
      EDGES.slice(1).map((to, index) => ({
        from: EDGES[index],
        to,
        revenue: '100.00',
        deals: 2,
      })),
    );
    expect(calls(aggregate)[1]).toContain(
      `"statusChangedAt":{"gte":"${EDGES[1]}","lt":"${EDGES[2]}"}`,
    );

    // A missing and a blank source are one "No Source"; the rows add up to the total.
    expect(result.sources).toEqual([
      {
        source: 'DoubleTick',
        revenue: '500.00',
        deals: 5,
        conversionRate: 20,
        priorRevenue: '200.00',
        change: 150,
      },
      {
        source: 'No Source',
        revenue: '50.00',
        deals: 2,
        conversionRate: 0,
        priorRevenue: '0.00',
        change: null,
      },
    ]);
    expect(result.pipelines).toEqual([
      {
        pipeline: 'Lead Pipeline',
        revenue: '550.00',
        deals: 7,
        lost: 3,
        winRate: 70,
      },
    ]);
  });

  it('reads LOST by when the lead became LOST, for the win rate', async () => {
    const { service, groupBy } = makeService();
    await service.overview(query({ ...PERIOD }));
    const lost = calls(groupBy).find((where) => where.includes('"LOST"'));
    expect(lost).toContain(
      `"statusChangedAt":{"gte":"${PERIOD.from}","lt":"${PERIOD.to}"}`,
    );
  });

  it('compares nothing without a comparison window, and sets no target without a period', async () => {
    const { service, groupBy, count } = makeService();
    const result = await service.overview(query({ targetMonths: 3 }));

    expect(result.prior).toBeNull();
    expect(Object.values(result.change)).toEqual([null, null, null, null]);
    expect(result.target).toMatchObject({ months: null, percent: null });
    expect(result.trend).toEqual([]);
    expect(count).not.toHaveBeenCalled();
    // All time: no window on any read.
    for (const where of calls(groupBy)) {
      expect(where).not.toContain('statusChangedAt');
      expect(where).not.toContain('createdAt');
    }
  });

  it('refuses trend edges that do not ascend', async () => {
    const { service } = makeService();
    await expect(
      service.overview(query({ edge: [EDGES[1], EDGES[0]] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RevenueReportService.deals', () => {
  it('pages the period’s deals in the chosen order, read in full for the page only', async () => {
    const { service, findMany, assignmentFindMany } = makeService();
    const result = await service.deals(
      query({
        ...PERIOD,
        sort: 'actualAmount',
        direction: 'desc',
        page: 1,
        size: 2,
      }),
    );

    expect(result.rows.map((row) => row.actualAmount)).toEqual(['1000', '145']);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.groups).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      status: 'WON',
      statusColor: 'lime',
      convertedAt: '2026-10-10T09:00:00.000Z',
      groupKey: null,
    });
    const [narrow, page] = calls(findMany);
    expect(narrow).toContain('"status":"WON"');
    expect(narrow).toContain('"statusChangedAt"');
    expect((findMany.mock.calls[0][0] as { take: number }).take).toBe(
      MAX_DEALS + 1,
    );
    // The page read keeps the scoped where and asks only for the page's ids.
    expect(page).toContain('"status":"WON"');
    expect(page).toContain(id(2));
    expect(page).not.toContain(id(1));
    // No assignee read when neither the grouping nor the sort needs one.
    expect(assignmentFindMany).not.toHaveBeenCalled();
  });

  it('groups by agent with the assignees read once, largest group first', async () => {
    const { service, assignmentFindMany } = makeService();
    const result = await service.deals(
      query({ ...PERIOD, group: 'agent', page: 1, size: 100 }),
    );

    expect(assignmentFindMany).toHaveBeenCalledTimes(1);
    expect(
      json((assignmentFindMany.mock.calls[0] as [{ where: unknown }])[0].where),
    ).toContain('"status":"WON"');
    expect(result.groups).toEqual([
      { key: 'agent:Ansar UAE', label: 'Ansar UAE', count: 1 },
      { key: 'agent:NIHAD V P', label: 'NIHAD V P', count: 1 },
      { key: 'agent:', label: 'OTHER', count: 1 },
    ]);
    expect(result.rows.map((row) => row.groupKey)).toEqual([
      'agent:Ansar UAE',
      'agent:NIHAD V P',
      'agent:',
    ]);
  });

  it('labels a role group by the organisational role, else the base role', async () => {
    const { service } = makeService();
    const result = await service.deals(query({ group: 'role' }));
    // One deal each, so alphabetical.
    expect(result.groups.map((entry) => entry.label)).toEqual([
      'OTHER',
      'Sales Agent',
      'Sales Manager',
    ]);
  });
});

describe('RevenueReportService.exportPdf', () => {
  it('sends the report and its deals as a PDF, and reports how many it lists', async () => {
    const { service } = makeService();
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
    };

    const listed = await service.exportPdf(
      query({
        ...PERIOD,
        ...PRIOR,
        edge: EDGES,
        targetMonths: 3,
        group: 'source',
        subtitle: 'Q4 2026 · All agents · All pipelines',
        label: ['Oct', 'Nov', 'Dec'],
      }),
      res as unknown as Response,
    );

    expect(listed).toBe(3);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="revenue-report-\d{8}-\d{6}\.pdf"$/,
      ),
    );
    const file = (res.end.mock.calls as [Buffer][])[0][0].toString('latin1');
    expect(file.startsWith('%PDF-1.4')).toBe(true);
    expect(file).toContain('(Revenue Report) Tj');
    expect(file).toContain('(Q4 2026 \xb7 All agents \xb7 All pipelines) Tj');
    expect(file).toContain('(550.00 AED) Tj');
    expect(file).toContain('(+175% vs prior period) Tj');
    expect(file).toContain('(18%) Tj');
    expect(file).toContain('(of 3,000.00 AED) Tj');
    // Every Deals header fits its column, uncut.
    for (const heading of ['Amount \\(AED\\)', 'Secondary Phone', 'Language'])
      expect(file).toContain(`(${heading}) Tj`);
    expect(file).toContain('(Oct) Tj');
    expect(file).toContain('(Revenue By Lead Source) Tj');
    expect(file).toContain('(Deals \\(3\\) \xb7 grouped by Lead Source) Tj');
    expect(file).toContain('(DoubleTick \\(2\\)) Tj');
  });
});
