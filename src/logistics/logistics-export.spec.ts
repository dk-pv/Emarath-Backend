import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LogisticsOrderFiltersDto } from './dto/logistics-order.dto';
import { ExportOrderRow } from './logistics-export.columns';
import { LogisticsOrdersService } from './logistics-orders.service';

const HEADER =
  'Order Number,Customer Name,Primary Phone,Secondary Phone,Street,City,State,Country,National Code,Product,Product Qty,Product 2,Product 2 Qty,Order Value,Payment Method,Delivery Date,QC Remarks\r\n';

function row(overrides: Partial<ExportOrderRow> = {}): ExportOrderRow {
  return {
    orderNumber: 1042,
    customerName: 'Ali Hassan',
    primaryPhone: '+971501234567',
    secondaryPhone: null,
    street: 'Villa 3',
    city: 'Dubai',
    state: 'Dubai',
    country: 'UAE',
    nationalCode: null,
    product: 'Gold Pack',
    productQty: new Prisma.Decimal('2'),
    product2: null,
    product2Qty: null,
    orderValue: new Prisma.Decimal('1500.50'),
    paymentMethod: 'COD',
    deliveryDate: new Date('2026-10-24T00:00:00.000Z'),
    qcRemarks: null,
    ...overrides,
  };
}

function makeService(
  pages: ExportOrderRow[][] = [[row()]],
  role: UserRole = UserRole.LOGISTICS_EXECUTIVE,
) {
  const findMany = jest.fn();
  for (const page of pages) findMany.mockResolvedValueOnce(page);
  findMany.mockResolvedValue([]);
  const prisma = { logisticsOrder: { findMany } } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role, team: null }),
  } as unknown as CurrentUserService;
  const config = {
    getOrThrow: () => ({ businessTimeZone: 'Asia/Dubai' }),
  } as unknown as ConfigService;
  return {
    service: new LogisticsOrdersService(prisma, currentUser, config),
    findMany,
  };
}

function makeResponse() {
  const chunks: string[] = [];
  const res = {
    status: jest.fn(),
    setHeader: jest.fn(),
    write: jest.fn((chunk: string) => chunks.push(chunk)),
    end: jest.fn(),
    destroy: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);
  return { res: res as unknown as Response, mock: res, chunks };
}

const filters = (
  values: Partial<LogisticsOrderFiltersDto> = {},
): LogisticsOrderFiltersDto =>
  Object.assign(new LogisticsOrderFiltersDto(), values);

const whereOf = (findMany: jest.Mock): string =>
  JSON.stringify((findMany.mock.calls[0] as [{ where: unknown }])[0].where);

describe('LogisticsOrdersService.exportCsv — which orders (3PL-01)', () => {
  it('exports QC-verified orders only: QC Verified is one more AND term beside the scope and the filters', async () => {
    const { service, findMany } = makeService();

    await service.exportCsv(
      filters({ country: ['UAE'], courier: ['Aramex'], search: 'Ali' }),
      makeResponse().res,
    );

    const [args] = findMany.mock.calls[0] as [{ where: { AND: unknown[] } }];
    expect(args.where.AND[1]).toEqual({ status: 'QC_VERIFIED' });
    const json = whereOf(findMany);
    expect(json).toContain('"country":{"in":["UAE"]}');
    expect(json).toContain('"courier":{"in":["Aramex"]}');
    expect(json).toContain('"customerName":{"contains":"Ali"');
  });

  it('lets a status filter narrow the file, never widen it: asking for Dispatched still requires QC Verified', async () => {
    const { service, findMany } = makeService([[]]);

    await expect(
      service.exportCsv(
        filters({ status: ['DISPATCHED', 'DELIVERED'] }),
        makeResponse().res,
      ),
    ).resolves.toBe(0);

    const json = whereOf(findMany);
    expect(json).toContain('"status":{"in":["DISPATCHED","DELIVERED"]}');
    expect(json).toContain('"status":"QC_VERIFIED"');
  });

  it('keeps the caller’s scope, as the List does: a sales role’s export would reach its own leads only', async () => {
    const { service, findMany } = makeService([[]], UserRole.SALES_AGENT);

    await service.exportCsv(filters(), makeResponse().res);

    expect(whereOf(findMany)).toContain('"assignments"');
  });

  it('reads in pages of 1,000, soonest delivery first, until a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, index) =>
      row({ orderNumber: index + 1 }),
    );
    const { service, findMany } = makeService([full, [row()]]);

    await expect(
      service.exportCsv(filters(), makeResponse().res),
    ).resolves.toBe(1001);

    expect(findMany).toHaveBeenCalledTimes(2);
    const [first, second] = findMany.mock.calls as [
      { skip: number; take: number; orderBy: unknown },
    ][];
    expect(first[0]).toMatchObject({
      skip: 0,
      take: 1000,
      orderBy: [
        { deliveryDate: { sort: 'asc', nulls: 'last' } },
        { orderNumber: 'asc' },
      ],
    });
    expect(second[0]).toMatchObject({ skip: 1000, take: 1000 });
  });
});

describe('LogisticsOrdersService.exportCsv — the file', () => {
  it('writes a BOM, the header and one line per order, and resolves to the rows written (the audit’s count)', async () => {
    const { service } = makeService([[row(), row({ orderNumber: 1043 })]]);
    const { res, mock, chunks } = makeResponse();

    await expect(service.exportCsv(filters(), res)).resolves.toBe(2);

    expect(mock.status).toHaveBeenCalledWith(200);
    expect(mock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(mock.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="qc-verified-orders-\d{8}-\d{6}\.csv"$/,
      ),
    );
    expect(chunks[0]).toBe('﻿' + HEADER);
    expect(chunks[1]).toBe(
      '1042,Ali Hassan,+971501234567,,Villa 3,Dubai,Dubai,UAE,,Gold Pack,2,,,1500.5,COD,2026-10-24,\r\n' +
        '1043,Ali Hassan,+971501234567,,Villa 3,Dubai,Dubai,UAE,,Gold Pack,2,,,1500.5,COD,2026-10-24,\r\n',
    );
    expect(mock.end).toHaveBeenCalledTimes(1);
  });

  it('answers an empty result with a header-only file and 0 rows, not an error', async () => {
    const { service } = makeService([[]]);
    const { res, mock, chunks } = makeResponse();

    await expect(service.exportCsv(filters(), res)).resolves.toBe(0);

    expect(mock.status).toHaveBeenCalledWith(200);
    expect(chunks).toEqual(['﻿' + HEADER]);
    expect(mock.end).toHaveBeenCalledTimes(1);
  });

  it('turns a cell a spreadsheet would run as a formula into text, keeps phone numbers as they are, and quotes commas', async () => {
    const { service } = makeService([
      [
        row({
          customerName: '=HYPERLINK("http://x","click")',
          secondaryPhone: '+971 50 123 4567',
          street: 'Villa 3, Street 9',
          product: '@SUM(A1)',
          qcRemarks: '-2+3',
          nationalCode: '+cmd',
        }),
      ],
    ]);
    const { res, chunks } = makeResponse();

    await service.exportCsv(filters(), res);

    const cells = chunks[1];
    expect(cells).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(cells).toContain(`'@SUM(A1)`);
    expect(cells).toContain(`'-2+3`);
    expect(cells).toContain(`'+cmd`);
    expect(cells).toContain(',+971501234567,+971 50 123 4567,');
    expect(cells).toContain('"Villa 3, Street 9"');
  });

  it('writes amounts as bare decimals, the delivery day as YYYY-MM-DD and missing values as empty cells', async () => {
    const { service } = makeService([
      [
        row({
          orderValue: null,
          productQty: new Prisma.Decimal('1.25'),
          product2: 'Refill',
          product2Qty: new Prisma.Decimal('3'),
          deliveryDate: null,
          paymentMethod: null,
        }),
      ],
    ]);
    const { res, chunks } = makeResponse();

    await service.exportCsv(filters(), res);

    expect(chunks[1]).toBe(
      '1042,Ali Hassan,+971501234567,,Villa 3,Dubai,Dubai,UAE,,Gold Pack,1.25,Refill,3,,,,\r\n',
    );
  });

  it('sends nothing when the first read fails, so the caller gets an ordinary error and no file', async () => {
    const { service, findMany } = makeService();
    findMany.mockReset().mockRejectedValue(new Error('database down'));
    const { res, mock } = makeResponse();

    await expect(service.exportCsv(filters(), res)).rejects.toThrow(
      'database down',
    );

    expect(mock.status).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });

  it('aborts the download when a later page fails, rather than ending a truncated file', async () => {
    const full = Array.from({ length: 1000 }, () => row());
    const { service, findMany } = makeService([full]);
    findMany.mockRejectedValueOnce(new Error('connection lost'));
    const { res, mock } = makeResponse();

    await expect(service.exportCsv(filters(), res)).rejects.toThrow(
      'connection lost',
    );

    expect(mock.destroy).toHaveBeenCalledWith(expect.any(Error));
    expect(mock.end).not.toHaveBeenCalled();
  });
});
