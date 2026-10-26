import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StagesService } from '../stages/stages.service';
import { SalesPipelineReportService } from './sales-pipeline.service';

const dec = (value: string) => new Prisma.Decimal(value);
const MONTH = {
  monthFrom: '2026-09-30T20:00:00.000Z',
  monthTo: '2026-10-31T20:00:00.000Z',
};
const WINDOW = {
  createdFrom: '2026-09-26T20:00:00.000Z',
  createdTo: '2026-10-26T20:00:00.000Z',
};

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const groupBy = jest
    .fn()
    .mockResolvedValue([
      { status: 'New', _count: 3, _sum: { actualAmount: dec('300') } },
    ]);
  const count = jest.fn().mockResolvedValue(9);
  const aggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { actualAmount: dec('500') } });
  const userAggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { monthlyGoalAmount: dec('1000') } });
  const prisma = {
    lead: { groupBy, count, aggregate },
    user: { aggregate: userAggregate },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role, team: null }),
  } as unknown as CurrentUserService;
  const list = jest.fn().mockResolvedValue([
    {
      id: 's-new',
      name: 'New',
      color: 'violet',
      isClosed: false,
      outcome: null,
      inclusion: 'INCLUDE_IN_SALES_PIPELINE',
      probability: 10,
    },
  ]);
  return {
    service: new SalesPipelineReportService(prisma, currentUser, {
      list,
    } as unknown as StagesService),
    groupBy,
    count,
    aggregate,
    userAggregate,
    list,
  };
}

const json = (value: unknown) => JSON.stringify(value);

describe('SalesPipelineReportService.report', () => {
  it('scopes the open pipeline like the board: created in the window, default pipeline', async () => {
    const { service, groupBy, list } = makeService(UserRole.SALES_AGENT);
    await service.report({ ...MONTH, ...WINDOW });

    expect(list).toHaveBeenCalledWith('Lead Pipeline');
    const where = json((groupBy.mock.calls as [{ where: unknown }][])[0][0]);
    expect(where).toContain('"pipeline":"Lead Pipeline"');
    expect(where).toContain('"createdAt"');
    // An agent's scope: only leads assigned to them.
    expect(where).toContain('"userId":"u1"');
  });

  it('counts Won by when the lead became WON, not when it was created', async () => {
    const { service, count } = makeService();
    await service.report({
      ...MONTH,
      ...WINDOW,
      pipeline: 'Complaints',
      source: ['Facebook'],
    });

    const where = (count.mock.calls as [{ where: { AND: unknown[] } }][])[0][0]
      .where;
    expect(where.AND[1]).toEqual({
      status: 'WON',
      statusChangedAt: {
        gte: new Date(WINDOW.createdFrom),
        lt: new Date(WINDOW.createdTo),
      },
    });
    const filters = json(where.AND[0]);
    expect(filters).not.toContain('"createdAt"');
    expect(filters).toContain('"pipeline":"Complaints"');
    expect(filters).toContain('Facebook');
  });

  it('counts every WON lead when the window is cleared', async () => {
    const { service, count } = makeService();
    await service.report({ ...MONTH });
    const where = (count.mock.calls as [{ where: { AND: unknown[] } }][])[0][0]
      .where;
    expect(where.AND[1]).toEqual({ status: 'WON' });
  });

  it('reads this month’s revenue and the members’ goals by the Dashboard’s rules', async () => {
    const { service, aggregate, userAggregate } = makeService();
    const result = await service.report({ ...MONTH, ...WINDOW });

    const converted = (aggregate.mock.calls as [{ where: unknown }][])[0][0]
      .where;
    expect(converted).toMatchObject({
      status: 'WON',
      statusChangedAt: {
        gte: new Date(MONTH.monthFrom),
        lt: new Date(MONTH.monthTo),
      },
    });
    expect((userAggregate.mock.calls as unknown[][])[0][0]).toMatchObject({
      _sum: { monthlyGoalAmount: true },
    });
    expect(result.revenue).toEqual({
      achieved: '500.00',
      target: '1000.00',
      percent: 50,
    });
    // 300 open ÷ 1,000 target.
    expect(result.coverage).toEqual({ ratio: 0.3, status: 'critical' });
    expect(result.won).toBe(9);
    expect(result.totals).toEqual({
      leads: 3,
      totalValue: '300.00',
      weightedValue: '30.00',
    });
  });

  it('has no target when no member has a monthly goal', async () => {
    const { service, userAggregate } = makeService();
    userAggregate.mockResolvedValue({ _sum: { monthlyGoalAmount: null } });
    const result = await service.report({ ...MONTH });
    expect(result.revenue.target).toBeNull();
    expect(result.coverage).toEqual({ ratio: null, status: null });
  });
});

describe('SalesPipelineReportService.exportPdf', () => {
  it('sends the report as a PDF attachment and reports its row count', async () => {
    const { service } = makeService();
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
    };

    const rows = await service.exportPdf(
      { ...MONTH, view: 'closing', subtitle: 'Last 30 Days · All agents' },
      res as unknown as Response,
    );

    expect(rows).toBe(1);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="sales-pipeline-\d{8}-\d{6}\.pdf"$/,
      ),
    );
    const file = (res.end.mock.calls as [Buffer][])[0][0].toString('latin1');
    expect(file.startsWith('%PDF-1.4')).toBe(true);
    expect(file).toContain('(Sales Pipeline Analysis) Tj');
    expect(file).toContain('(0.30\xd7) Tj');
    expect(file).toContain('need an expected closing date');
  });
});
