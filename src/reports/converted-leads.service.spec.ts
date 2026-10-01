import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ConvertedLeadsReportService } from './converted-leads.service';
import { ConvertedLeadsQueryDto } from './dto/converted-leads-query.dto';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = 'agent-1';

const dec = (value: string) => new Prisma.Decimal(value);

/** A row shaped like CONVERTED_LIST_SELECT — enough for toLeadListItem to run. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    name: 'Acme',
    firstName: null,
    primaryPhone: '900',
    secondaryPhone: null,
    email: null,
    language: null,
    country: null,
    source: 'DoubleTick',
    status: 'WON',
    pipeline: 'Lead Pipeline',
    category: null,
    actualAmount: dec('1500.50'),
    forecastedAmount: null,
    bookingDate: null,
    callStatus: null,
    callAttempts: 0,
    whatsappAttempts: 0,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T09:00:00.000Z'),
    statusChangedAt: new Date('2026-09-10T09:00:00.000Z'),
    state: null,
    street: null,
    city: null,
    product: null,
    productQty: null,
    product2: null,
    product2Qty: null,
    paymentMethod: null,
    nationalCode: null,
    complaints: [],
    assignments: [],
    tags: [],
    customFieldValues: [],
    _count: { activities: 0, calls: 0 },
    ...overrides,
  };
}

/** A row shaped like CONVERTED_EXPORT_SELECT — the CSV's six cells. */
function exportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    name: 'Acme',
    firstName: 'Ali',
    primaryPhone: '900',
    source: 'DoubleTick',
    actualAmount: dec('1500.50'),
    assignments: [{ user: { id: AGENT_ID, name: 'Ansar' } }],
    ...overrides,
  };
}

function makeService(
  rows: Record<string, unknown>[] = [listRow()],
  role: UserRole = UserRole.SUPERADMIN,
) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(rows.length);
  const stageFindMany = jest.fn().mockResolvedValue([
    { name: 'WON', color: 'emerald' },
    { name: 'New', color: 'slate' },
  ]);

  const prisma = {
    lead: { findMany, count },
    stage: { findMany: stageFindMany },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role }),
  } as unknown as CurrentUserService;

  return {
    service: new ConvertedLeadsReportService(prisma, currentUser),
    findMany,
    count,
  };
}

const query = (
  over: Partial<ConvertedLeadsQueryDto> = {},
): ConvertedLeadsQueryDto => ({ page: 1, size: 25, ...over });

/** A response that only records what was written to it. */
function makeResponse() {
  const chunks: string[] = [];
  const res = {
    status: jest.fn(),
    setHeader: jest.fn(),
    write: jest.fn((chunk: string) => chunks.push(chunk)),
    end: jest.fn(),
  };
  // The service chains `status().setHeader().setHeader()`.
  res.status.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);
  return { res: res as unknown as Response, chunks };
}

/*
  Characterization only (ADR-0085 §B): what this report counts as converted TODAY, so a
  Logistics-era change to the WON rule cannot move it unnoticed. None of these states what
  the metric ought to become.
*/
describe('ConvertedLeadsReportService.listDetailed', () => {
  it('selects WON alone — not the "Converted" stage, not a QC stage', async () => {
    const { service, findMany } = makeService();

    await service.listDetailed(query());

    const [args] = findMany.mock.calls[0] as [{ where: unknown }];
    const json = JSON.stringify(args.where);
    expect(json).toContain('"status":{"in":["WON"]}');
    expect(json).not.toContain('Converted');
    expect(json).not.toContain('QC');
  });

  it('leaves archived leads out and keeps an agent to their own leads', async () => {
    const { service, findMany } = makeService(
      [listRow()],
      UserRole.SALES_AGENT,
    );

    await service.listDetailed(query());

    const [args] = findMany.mock.calls[0] as [{ where: unknown }];
    const json = JSON.stringify(args.where);
    expect(json).toContain('"deletedAt":null');
    expect(json).toContain('"userId":"agent-1"');
  });

  it('counts over exactly the query it pages, so total never describes another set', async () => {
    const { service, findMany, count } = makeService();

    await service.listDetailed(query({ page: 3, size: 25 }));

    const [page] = findMany.mock.calls[0] as [
      { where: unknown; skip: number; take: number },
    ];
    const [tally] = count.mock.calls[0] as [{ where: unknown }];
    expect(tally.where).toBe(page.where);
    expect(page.skip).toBe(50);
    expect(page.take).toBe(25);
  });

  it('reports the conversion instant as statusChangedAt, and colours the row from its stage', async () => {
    const { service } = makeService();

    const { rows } = await service.listDetailed(query());

    expect(rows[0].convertedAt).toBe('2026-09-10T09:00:00.000Z');
    expect(rows[0].statusColor).toBe('emerald');
    expect(rows[0].actualAmount).toBe('1500.5');
  });

  it('leaves the colour null for a status no stage carries', async () => {
    const { service } = makeService([listRow({ status: 'QC NOT APPROVED' })]);

    const { rows } = await service.listDetailed(query());

    // The row is still returned as-is: the projection never re-checks the status.
    expect(rows[0].status).toBe('QC NOT APPROVED');
    expect(rows[0].statusColor).toBeNull();
  });

  it('returns every matching lead in the page, with the scoped count as total', async () => {
    const { service } = makeService([
      listRow(),
      listRow({ id: '33333333-3333-3333-3333-333333333333', name: 'Beta' }),
    ]);

    const { rows, total } = await service.listDetailed(query());

    expect(rows.map((row) => row.name)).toEqual(['Acme', 'Beta']);
    expect(total).toBe(2);
  });

  it('returns an empty report, not an error, when nothing converted', async () => {
    const { service } = makeService([]);

    await expect(service.listDetailed(query())).resolves.toEqual({
      rows: [],
      total: 0,
    });
  });

  it('orders newest first, with id breaking ties so a row never repeats across pages', async () => {
    const { service, findMany } = makeService();

    await service.listDetailed(query());

    const [args] = findMany.mock.calls[0] as [{ orderBy: unknown }];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });

  it('threads the source and agent filters into the same scoped query', async () => {
    const { service, findMany } = makeService();

    await service.listDetailed(
      query({ source: ['Walk-in'], agent: ['u-1', 'u-2'] }),
    );

    const [args] = findMany.mock.calls[0] as [{ where: unknown }];
    const json = JSON.stringify(args.where);
    expect(json).toContain('"source":{"in":["Walk-in"]}');
    expect(json).toContain('"userId":{"in":["u-1","u-2"]}');
    // Still WON: a filter narrows the converted set, it never widens it.
    expect(json).toContain('"status":{"in":["WON"]}');
  });

  it('reads the default period off createdAt, as a half-open window', async () => {
    const { service, findMany } = makeService();

    await service.listDetailed(
      query({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    );

    const [args] = findMany.mock.calls[0] as [{ where: unknown }];
    const json = JSON.stringify(args.where);
    // "created in the period and currently WON" — the upper bound is exclusive.
    expect(json).toContain(
      '"createdAt":{"gte":"2026-09-01T00:00:00.000Z","lt":"2026-10-01T00:00:00.000Z"}',
    );
    expect(json).not.toContain('statusChangedAt');
  });

  it('moves the window onto statusChangedAt for a Converted Date filter', async () => {
    const { service, findMany } = makeService();

    await service.listDetailed(
      query({
        dateField: 'statusChanged',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    );

    const [args] = findMany.mock.calls[0] as [{ where: unknown }];
    const json = JSON.stringify(args.where);
    expect(json).toContain('"statusChangedAt"');
    expect(json).not.toContain('"createdAt"');
  });
});

describe('ConvertedLeadsReportService.exportCsv', () => {
  it('writes the six headers and the amount as a bare number', async () => {
    const { service } = makeService([exportRow()]);
    const { res, chunks } = makeResponse();

    await service.exportCsv(query(), res);

    expect(chunks[1]).toBe(
      'Customer Name,First Name,Primary Phone,Source,Assigned,Actual Amount\r\n',
    );
    expect(chunks[2]).toBe('Acme,Ali,900,DoubleTick,Ansar,1500.5\r\n');
  });

  it('writes an empty amount cell when the converted lead carries none', async () => {
    const { service } = makeService([exportRow({ actualAmount: null })]);
    const { res, chunks } = makeResponse();

    await service.exportCsv(query(), res);

    expect(chunks[2]).toBe('Acme,Ali,900,DoubleTick,Ansar,\r\n');
  });

  it('exports through the same scoped WON query the visible report uses', async () => {
    const { service, findMany } = makeService([exportRow()]);
    const { res } = makeResponse();

    await service.exportCsv(query({ source: ['DoubleTick'] }), res);

    const [args] = findMany.mock.calls[0] as [{ where: unknown }];
    const json = JSON.stringify(args.where);
    expect(json).toContain('"status":{"in":["WON"]}');
    expect(json).toContain('"deletedAt":null');
    expect(json).toContain('DoubleTick');
  });

  it('stops after a short batch rather than paging forever', async () => {
    const { service, findMany } = makeService([exportRow()]);
    const { res } = makeResponse();

    await service.exportCsv(query(), res);

    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
