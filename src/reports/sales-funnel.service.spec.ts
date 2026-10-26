import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StagesService } from '../stages/stages.service';
import { SalesFunnelReportService } from './sales-funnel.service';

const dec = (value: string) => new Prisma.Decimal(value);
const STAGES = [
  {
    id: 's-new',
    name: 'New',
    color: 'violet',
    isClosed: false,
    outcome: null,
    inclusion: 'INCLUDE_IN_SALES_PIPELINE',
    probability: 0,
  },
  {
    id: 's-hot',
    name: 'HOT',
    color: 'amber',
    isClosed: false,
    outcome: null,
    inclusion: 'INCLUDE_IN_SALES_PIPELINE',
    probability: 50,
  },
  {
    id: 's-won',
    name: 'WON',
    color: 'lime',
    isClosed: true,
    outcome: 'WON',
    inclusion: 'INCLUDE_IN_SALES_PIPELINE',
    probability: 0,
  },
];

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const groupBy = jest.fn().mockResolvedValue([
    { status: 'New', _count: 2, _sum: { actualAmount: dec('10') } },
    { status: 'WON', _count: 1, _sum: { actualAmount: dec('500') } },
  ]);
  const count = jest.fn().mockResolvedValue(3);
  const findMany = jest.fn().mockResolvedValue([]);
  const auditFindMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    lead: { groupBy, count, findMany },
    auditEvent: { findMany: auditFindMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;
  const list = jest.fn().mockResolvedValue(STAGES);
  const stages = { list } as unknown as StagesService;
  return {
    service: new SalesFunnelReportService(prisma, currentUser, stages),
    groupBy,
    count,
    findMany,
    auditFindMany,
    list,
  };
}

const lead = (id: string, status: string, amount: string | null = null) => ({
  id,
  status,
  actualAmount: amount === null ? null : dec(amount),
});

describe('SalesFunnelReportService.report', () => {
  it('reads the Kanban board’s own scoped leads for the default board, Full view', async () => {
    const { service, groupBy, count, list, findMany } = makeService(
      UserRole.SALES_AGENT,
    );
    await service.report({});

    expect(list).toHaveBeenCalledWith('Lead Pipeline');
    const where = (groupBy.mock.calls as [{ where: unknown }][])[0][0].where;
    // The same where for the rollup, the total and the Full view's lead batches.
    expect((count.mock.calls as [{ where: unknown }][])[0][0].where).toBe(
      where,
    );
    expect((findMany.mock.calls as [{ where: unknown }][])[0][0].where).toBe(
      where,
    );
    expect(JSON.stringify(where)).toContain('"pipeline":"Lead Pipeline"');
    // An agent's scope: only leads assigned to them.
    expect(JSON.stringify(where)).toContain('"userId":"u1"');
  });

  it('counts Live from where leads are now and reads no history', async () => {
    const { service, findMany, auditFindMany } = makeService();
    const result = await service.report({
      view: 'live',
      pipeline: 'Lead Pipeline',
    });

    expect(findMany).not.toHaveBeenCalled();
    expect(auditFindMany).not.toHaveBeenCalled();
    expect(result.table.map((row) => [row.stage.name, row.count])).toEqual([
      ['New', 2],
    ]);
    expect(result.totals.leads).toBe(2);
    expect(result.conversionRate).toBeCloseTo(100 / 3, 10);
  });

  it('counts Full from every stage each lead has been in, a batch at a time', async () => {
    const { service, findMany, auditFindMany } = makeService();
    const first = Array.from({ length: 1000 }, (_, index) =>
      lead(`a${String(index).padStart(4, '0')}`, 'New', '1'),
    );
    findMany
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([lead('b0001', 'WON', '500')]);
    auditFindMany
      // The pipeline's stage renames.
      .mockResolvedValueOnce([])
      // Batch one: one of its leads went New → HOT → New.
      .mockResolvedValueOnce([
        {
          entityId: 'a0000',
          createdAt: new Date('2026-10-02T00:00:00Z'),
          before: { status: 'New' },
          after: { status: 'HOT' },
        },
        {
          entityId: 'a0000',
          createdAt: new Date('2026-10-03T00:00:00Z'),
          before: { status: 'HOT' },
          after: { status: 'New' },
        },
      ])
      // Batch two: created in New, now WON.
      .mockResolvedValueOnce([
        {
          entityId: 'b0001',
          createdAt: new Date('2026-10-04T00:00:00Z'),
          before: { status: 'New' },
          after: { status: 'WON' },
        },
      ]);

    const result = await service.report({ includeLost: false });

    const leadReads = findMany.mock.calls as unknown[][];
    const auditReads = auditFindMany.mock.calls as unknown[][];
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(leadReads[1][0]).toMatchObject({
      cursor: { id: 'a0999' },
      skip: 1,
      take: 1000,
      orderBy: { id: 'asc' },
    });
    expect(auditReads[0][0]).toMatchObject({
      where: {
        entityType: 'STAGE',
        action: 'RENAMED',
        metadata: { path: ['pipeline'], equals: 'Lead Pipeline' },
      },
    });
    expect(auditReads[1][0]).toMatchObject({
      where: {
        entityType: 'LEAD',
        action: { in: ['STATUS_CHANGED', 'CONVERTED'] },
      },
    });
    expect(
      (auditReads[1][0] as { where: { entityId: { in: string[] } } }).where
        .entityId.in,
    ).toHaveLength(1000);

    expect(
      result.funnel.map((row) => [row.stage.name, row.count, row.totalValue]),
    ).toEqual([
      ['New', 1001, '1500.00'],
      ['HOT', 1, '1.00'],
      ['WON', 1, '500.00'],
    ]);
    expect(result.table.map((row) => row.stage.name)).toEqual(['New', 'HOT']);
    // Every lead in scope (the mocked total), not the sum of the stages.
    expect(result.totals.leads).toBe(3);
    expect(result.totals.weightedValue).toBe('0.50');
  });
});

describe('SalesFunnelReportService.exportPdf', () => {
  it('sends the report as a PDF attachment and reports its row count', async () => {
    const { service } = makeService();
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
    };

    const rows = await service.exportPdf(
      { view: 'live', subtitle: 'Last 30 Days · All agents · Lead Pipeline' },
      res as unknown as Response,
    );

    expect(rows).toBe(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="sales-funnel-\d{8}-\d{6}\.pdf"$/,
      ),
    );
    const file = (res.end.mock.calls as [Buffer][])[0][0];
    expect(file.toString('latin1', 0, 8)).toBe('%PDF-1.4');
  });
});
