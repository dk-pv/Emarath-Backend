import 'reflect-metadata';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { CurrentUser, CurrentUserService } from '../../auth/current-user';
import { LeadCustomFieldsService } from '../../lead-custom-fields/lead-custom-fields.service';
import { LeadCustomFieldType, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportLeadsQueryDto } from './dto/export-leads-query.dto';
import { EXPORT_COLUMNS, LeadExportRow } from './leads-export.columns';
import { LeadsExportService } from './leads-export.service';

/**
 * The export as the user receives it: the service runs against a fake Prisma and the
 * file it writes is read back — CSV as text, XLSX through ExcelJS — so the assertions
 * are on real headers and real cells, not on the helpers that built them.
 */

const FIELDS = [
  {
    id: 'f1',
    key: 'cf_notes',
    name: 'Site Notes',
    type: LeadCustomFieldType.TEXT,
  },
  {
    id: 'f2',
    key: 'cf_visit',
    name: 'Visit Date',
    type: LeadCustomFieldType.DATE,
  },
  {
    id: 'f3',
    key: 'cf_slot',
    name: 'Visit Slot',
    type: LeadCustomFieldType.DATETIME,
  },
  {
    id: 'f4',
    key: 'cf_size',
    name: 'Size',
    type: LeadCustomFieldType.NUMBER,
  },
];

const BOM = String.fromCharCode(0xfeff);
const stripBom = (text: string) =>
  text.startsWith(BOM) ? text.slice(1) : text;

/** The first argument of a mock's first call, typed by the caller. */
function firstArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

function row(
  name: string,
  values: Record<string, string> = {},
  extra: Partial<LeadExportRow> = {},
): LeadExportRow {
  return {
    name,
    firstName: null,
    primaryPhone: '971500000001',
    secondaryPhone: null,
    language: null,
    country: 'UAE',
    source: null,
    status: 'Cold',
    pipeline: 'Lead Pipeline',
    category: null,
    product: null,
    productQty: null,
    product2: null,
    product2Qty: null,
    bookingDate: null,
    actualAmount: null,
    forecastedAmount: null,
    paymentMethod: null,
    state: null,
    street: null,
    city: null,
    nationalCode: null,
    callStatus: null,
    callAttempts: 0,
    whatsappAttempts: 0,
    createdAt: new Date('2026-10-13T06:00:00.000Z'),
    complaints: [],
    assignments: [],
    tags: [],
    customFieldValues: Object.entries(values).map(([key, value]) => ({
      value,
      customField: { key },
    })),
    ...extra,
  };
}

function setup(
  rows: LeadExportRow[],
  user: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN, team: null },
  fields = FIELDS,
) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { lead: { findMany } } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue(user),
  } as unknown as CurrentUserService;
  const list = jest.fn().mockResolvedValue(fields);
  const customFields = { list } as unknown as LeadCustomFieldsService;
  const service = new LeadsExportService(prisma, currentUser, customFields);
  return { service, findMany, list };
}

function query(overrides: Partial<ExportLeadsQueryDto>): ExportLeadsQueryDto {
  return Object.assign(new ExportLeadsQueryDto(), {
    format: 'csv',
    scope: 'default',
    ...overrides,
  });
}

/** Runs a CSV export and returns the file as a header line plus data lines. */
async function csv(
  service: LeadsExportService,
  overrides: Partial<ExportLeadsQueryDto>,
): Promise<{ header: string[]; lines: string[]; text: string }> {
  const chunks: string[] = [];
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: jest.fn(),
    destroy: jest.fn(),
  };
  await service.export(query(overrides), res as unknown as Response);
  const text = stripBom(chunks.join(''));
  const [header, ...lines] = text.split('\r\n').filter((l) => l.length > 0);
  return { header: header.split(','), lines, text };
}

describe('LeadsExportService — Manage Columns selections reach the file', () => {
  it('writes a selected custom column that used to be dropped, in the user’s order', async () => {
    const { service } = setup([
      row('Aisha', { cf_notes: 'Gate 4' }),
      row('Omar', { cf_notes: 'Call after 5' }),
    ]);

    const { header, lines } = await csv(service, {
      columns: 'name,cf_notes,status',
    });

    // The custom column sits between the two standard ones, exactly where it was placed.
    expect(header).toEqual(['Customer Name', 'Site Notes', 'Lead Status']);
    expect(lines).toEqual(['Aisha,Gate 4,Cold', 'Omar,Call after 5,Cold']);
  });

  it('keeps every cell under its own header when some leads have no value', async () => {
    const { service } = setup([
      row('Aisha', { cf_notes: 'Gate 4', cf_size: '12.5' }),
      row('No Values'),
      row('Only Size', { cf_size: '3' }),
    ]);

    const { header, lines } = await csv(service, {
      columns: 'name,cf_notes,cf_size,status',
    });

    expect(header).toEqual([
      'Customer Name',
      'Site Notes',
      'Size',
      'Lead Status',
    ]);
    // Empty custom cells stay empty — the next column's value never slides left.
    expect(lines).toEqual([
      'Aisha,Gate 4,12.5,Cold',
      'No Values,,,Cold',
      'Only Size,,3,Cold',
    ]);
    for (const line of lines)
      expect(line.split(',')).toHaveLength(header.length);
  });

  it('formats custom DATE and DATETIME as typed, not shifted through UTC', async () => {
    const { service } = setup([
      row('Aisha', { cf_visit: '2026-10-13', cf_slot: '2026-10-13T15:00' }),
      row('Omar', { cf_visit: '2026-01-02', cf_slot: '2026-01-02T00:05' }),
    ]);

    const { lines } = await csv(service, { columns: 'name,cf_visit,cf_slot' });

    expect(lines).toEqual([
      'Aisha,13-10-2026,"13-10-2026, 03:00 PM"',
      'Omar,02-01-2026,"02-01-2026, 12:05 AM"',
    ]);
  });

  it('quotes custom text that carries commas, quotes or line breaks', async () => {
    const { service } = setup([
      row('Aisha', { cf_notes: 'Call, then "text"\nlater' }),
    ]);

    const { text } = await csv(service, { columns: 'name,cf_notes' });

    expect(text).toContain('Aisha,"Call, then ""text""\nlater"\r\n');
  });

  it('"All Fields" appends every active custom field after the standard columns', async () => {
    const { service } = setup([row('Aisha', { cf_size: '7' })]);

    const { header } = await csv(service, { scope: 'all' });

    const standard = EXPORT_COLUMNS.map((c) => c.header);
    expect(header.slice(0, standard.length)).toEqual(standard);
    expect(header.slice(standard.length)).toEqual([
      'Site Notes',
      'Visit Date',
      'Visit Slot',
      'Size',
    ]);
  });

  it('leaves out a custom column that is no longer active, without breaking the file', async () => {
    // cf_gone was selected when the layout was saved; the field has since been deactivated.
    const { service, findMany } = setup([row('Aisha', { cf_notes: 'x' })]);

    const { header } = await csv(service, {
      columns: 'name,cf_gone,cf_notes',
    });

    expect(header).toEqual(['Customer Name', 'Site Notes']);
    const select = firstArg<{ select: object }>(findMany).select;
    expect(JSON.stringify(select)).toContain('"in":["cf_notes"]');
    expect(JSON.stringify(select)).not.toContain('cf_gone');
  });

  it('keeps standard-only exports exactly as they were, and reads no custom values for them', async () => {
    const { service, findMany } = setup([row('Aisha')]);

    const { header, lines } = await csv(service, {
      columns: 'name,primaryPhone,country',
    });

    expect(header).toEqual(['Customer Name', 'Primary Phone', 'Country']);
    expect(lines).toEqual(['Aisha,971500000001,UAE']);
    const select = firstArg<{ select: object }>(findMany).select;
    expect(select).not.toHaveProperty('customFieldValues');
  });

  it('writes the header alone for an empty result', async () => {
    const { service } = setup([]);

    const { header, lines } = await csv(service, {
      columns: 'name,cf_notes',
    });

    expect(header).toEqual(['Customer Name', 'Site Notes']);
    expect(lines).toEqual([]);
  });
});

describe('LeadsExportService — filters and role scope still bound the export', () => {
  it('ANDs the caller’s scope and the active filters into the query the file is read with', async () => {
    const { service, findMany } = setup([row('Aisha', { cf_notes: 'x' })], {
      id: 'agent-1',
      role: UserRole.SALES_AGENT,
      team: null,
    });

    await csv(service, {
      columns: 'name,cf_notes',
      status: ['Cold'],
      sort: 'createdAt',
      direction: 'asc',
    });

    const args = firstArg<{
      where: { AND: Record<string, unknown>[] };
      orderBy: unknown;
    }>(findMany);
    const where = JSON.stringify(args.where);
    // The agent's own-leads scope and the status filter are both in the one query.
    expect(where).toContain('"userId":"agent-1"');
    expect(where).toContain('"status":{"in":["Cold"]}');
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('does not ask for custom values — or any other column — beyond those it writes', async () => {
    const { service, findMany } = setup([row('Aisha')]);

    await csv(service, { columns: 'name,cf_size' });

    const select = firstArg<{ select: object }>(findMany).select;
    expect(JSON.stringify(select)).toContain('"in":["cf_size"]');
  });
});

describe('LeadsExportService — XLSX', () => {
  it('writes the same headers and cells into the worksheet', async () => {
    const { service } = setup([
      row('Aisha', { cf_notes: 'Gate 4', cf_visit: '2026-10-13' }),
      row('Omar'),
    ]);
    const out = new PassThrough();
    const buffers: Buffer[] = [];
    out.on('data', (chunk: Buffer) => buffers.push(chunk));
    Object.assign(out, {
      status: () => out,
      setHeader: () => out,
    });

    await service.export(
      query({ format: 'xlsx', columns: 'name,cf_visit,status,cf_notes' }),
      out as unknown as Response,
    );
    await finished(out);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(buffers) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Leads')!;
    const cells = (n: number) =>
      (sheet.getRow(n).values as (string | undefined)[]).slice(1);

    expect(cells(1)).toEqual([
      'Customer Name',
      'Visit Date',
      'Lead Status',
      'Site Notes',
    ]);
    expect(cells(2)).toEqual(['Aisha', '13-10-2026', 'Cold', 'Gate 4']);
    // An empty cell is blank, and Status still lands under Lead Status.
    expect(cells(3)[0]).toBe('Omar');
    expect(cells(3)[2]).toBe('Cold');
    expect(sheet.rowCount).toBe(3);
  });
});
