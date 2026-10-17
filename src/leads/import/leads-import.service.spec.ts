import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { EvaluatedRow } from '../../common/import/import-descriptor';
import {
  EvaluationResult,
  ImportEngineService,
} from '../../common/import/import-engine.service';
import { LeadsImportDescriptor } from './leads-import.descriptor';
import { LEADS_IMPORT_FIELDS } from './leads-import.fields';
import { ImportJobRepository } from './import-job.repository';
import { LeadsImportService } from './leads-import.service';
import { ImportBodyDto } from './dto/import-body.dto';
import { toImportJobResponse } from './dto/import-response.dto';

const csv = (body: string) => {
  const buffer = Buffer.from(body, 'utf8');
  return { originalname: 'leads.csv', buffer, size: buffer.length };
};

/** A mapping that satisfies the required fields and maps two optional ones. */
const VALID_MAPPING = JSON.stringify({
  'Customer Name': 'name',
  Phone: 'primaryPhone',
  Amount: 'actualAmount',
  Pay: 'paymentMethod',
});

const HEADER = 'Customer Name,Phone,Amount,Pay';

function evalResult(rows: Partial<EvaluatedRow>[]): EvaluationResult {
  const full = rows.map((row, index) => ({
    rowNumber: index + 2,
    values: {},
    mapped: {},
    status: 'valid' as const,
    error: null,
    ...row,
  }));
  return {
    rows: full,
    summary: {
      total: full.length,
      valid: full.filter((r) => r.status === 'valid').length,
      invalid: full.filter((r) => r.status === 'invalid').length,
      duplicates: full.filter((r) => r.status === 'duplicate').length,
    },
  };
}

function makeService(
  role: UserRole = UserRole.SUPERADMIN,
  importsDuplicates = false,
  defaultStatus = 'New',
) {
  // Held as locals (not read off the mocks) so the assertions never reference an
  // unbound class method — the pattern leads.service.spec uses.
  const evaluate = jest.fn();
  const persistValid = jest.fn().mockResolvedValue(0);
  const create = jest.fn().mockResolvedValue({ id: 'job-1' });
  const update = jest.fn().mockResolvedValue(undefined);
  const findScoped = jest.fn();
  const runFields = [...LEADS_IMPORT_FIELDS];
  const prepare = jest
    .fn()
    .mockResolvedValue({ fields: runFields, defaultStatus });

  // The row-selection rule is the real one; only evaluation and the write are stubbed.
  const realEngine = new ImportEngineService();
  const engine = {
    evaluate,
    persistValid,
    writable: (rows: EvaluatedRow[], target: { importsDuplicates?: boolean }) =>
      realEngine.writable(rows, target),
    summarise: (rows: EvaluatedRow[]) => realEngine.summarise(rows),
  } as unknown as ImportEngineService;

  const descriptor = {
    module: 'leads',
    importsDuplicates,
    fields: LEADS_IMPORT_FIELDS,
    prepare,
    sampleRows: jest
      .fn()
      .mockResolvedValue([{ name: 'Ahmed Ali', primaryPhone: '971501234567' }]),
  } as unknown as LeadsImportDescriptor;

  const jobs = {
    create,
    update,
    findScoped,
    findErrors: jest.fn(),
    history: jest.fn().mockResolvedValue([]),
  } as unknown as ImportJobRepository;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;

  const service = new LeadsImportService(engine, descriptor, jobs, currentUser);
  return {
    service,
    evaluate,
    persistValid,
    create,
    update,
    findScoped,
    prepare,
    runFields,
  };
}

const body = (mapping: string, pipeline = 'Lead Pipeline'): ImportBodyDto => ({
  mapping,
  pipeline,
});

describe('LeadsImportService.fields', () => {
  it('requires exactly what the New Lead form requires (ADR-0088)', () => {
    const { service } = makeService();
    const { fields } = service.fields();
    const required = fields.filter((f) => f.required).map((f) => f.value);
    expect(required).toEqual(['name', 'primaryPhone']);
    expect(fields.map((f) => f.value)).toContain('email');
  });
});

describe('LeadsImportService.validate', () => {
  it('rejects a mapping missing a required field', async () => {
    const { service } = makeService();
    const mapping = JSON.stringify({ 'Customer Name': 'name' });
    await expect(
      service.validate(csv(`${HEADER}\nA,1,2,COD`), body(mapping)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a field mapped from two columns', async () => {
    const { service } = makeService();
    const mapping = JSON.stringify({
      'Customer Name': 'name',
      Phone: 'primaryPhone',
      Mobile: 'primaryPhone',
    });
    await expect(
      service.validate(
        csv(`${HEADER},Mobile
A,1,2,COD,3`),
        body(mapping),
      ),
    ).rejects.toThrow('Primary Phone is mapped from more than one column');
  });

  it('rejects a mapping onto a field the catalog does not have', async () => {
    const { service } = makeService();
    const mapping = JSON.stringify({
      'Customer Name': 'name',
      Phone: 'primaryPhone',
      Amount: 'password',
    });
    await expect(
      service.validate(csv(`${HEADER}\nA,1,2,COD`), body(mapping)),
    ).rejects.toThrow('"password" is not an import field.');
  });

  it('rejects malformed mapping JSON', async () => {
    const { service } = makeService();
    await expect(
      service.validate(csv(`${HEADER}\nA,1,2,COD`), body('not-json')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns whole-file counts and a bounded row window', async () => {
    const { service, evaluate } = makeService();
    evaluate.mockResolvedValue(
      evalResult([
        { status: 'valid' },
        {
          status: 'invalid',
          error: { reason: 'bad', errorCode: 'INVALID_NUMBER' },
        },
      ]),
    );
    const result = await service.validate(
      csv(`${HEADER}\nA,1,2,COD\nB,x,2,COD`),
      body(VALID_MAPPING),
    );
    expect(result.total).toBe(2);
    expect(result.valid).toBe(1);
    expect(result.invalid).toBe(1);
    // Rows that need attention come first in the bounded window.
    expect(result.rows[0].error?.errorCode).toBe('INVALID_NUMBER');
    expect(result.rows[1].status).toBe('valid');
  });

  it('checks rows against the run’s fields for the chosen pipeline', async () => {
    const { service, evaluate, prepare, runFields } = makeService();
    evaluate.mockResolvedValue(evalResult([{ status: 'valid' }]));

    await service.validate(
      csv(`${HEADER}
A,1,2,COD`),
      body(VALID_MAPPING, 'Complaints'),
    );

    expect(prepare).toHaveBeenCalledWith('Complaints', {
      id: 'u1',
      role: 'SUPERADMIN',
    });
    expect((evaluate.mock.calls[0] as unknown[])[3]).toBe(runFields);
  });

  // ADR-0093: validate and the import each check the pipeline themselves, as the importer.
  it('hands prepare the importer, on validate and on the import alike', async () => {
    const { service, evaluate, prepare } = makeService();
    evaluate.mockResolvedValue(evalResult([{ status: 'valid' }]));
    prepare.mockRejectedValue(new Error('closed'));

    await expect(
      service.validate(csv(`${HEADER}\nA,1,2,COD`), body(VALID_MAPPING, 'VIP')),
    ).rejects.toThrow('closed');
    await expect(
      service.startImport(
        csv(`${HEADER}\nA,1,2,COD`),
        body(VALID_MAPPING, 'VIP'),
      ),
    ).rejects.toThrow('closed');

    for (const call of [1, 2]) {
      expect(prepare).toHaveBeenNthCalledWith(
        call,
        'VIP',
        expect.objectContaining({ id: 'u1' }),
      );
    }
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('LeadsImportService.startImport', () => {
  it('creates a PROCESSING job with settled counts and returns the id', async () => {
    const { service, evaluate, persistValid, create, update } = makeService();
    evaluate.mockResolvedValue(
      evalResult([
        { status: 'valid', mapped: { name: 'A', primaryPhone: '1' } },
        {
          status: 'duplicate',
          error: { reason: 'dup', errorCode: 'DUPLICATE_EXISTING' },
        },
      ]),
    );

    const result = await service.startImport(
      csv(`${HEADER}\nA,1,2,COD\nB,1,2,COD`),
      body(VALID_MAPPING),
    );

    expect(result).toEqual({ jobId: 'job-1' });
    const created = (create.mock.calls as unknown[][])[0][0] as {
      status: string;
      skippedCount: number;
      failedCount: number;
      processedRows: number;
    };
    expect(created.status).toBe('PROCESSING');
    expect(created.skippedCount).toBe(1);
    expect(created.failedCount).toBe(0);
    expect(created.processedRows).toBe(1); // the settled duplicate

    // The async write runs after the response; let the microtask drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(persistValid).toHaveBeenCalled();
    const completed = (update.mock.calls as unknown[][]).at(-1)?.[1] as {
      status: string;
    };
    expect(completed).toMatchObject({ status: 'COMPLETED' });
  });

  it('hands the job id to the batch writer, so each created lead names its import (ADR-0083)', async () => {
    const { service, evaluate, persistValid } = makeService();
    evaluate.mockResolvedValue(
      evalResult([
        { status: 'valid', mapped: { name: 'A', primaryPhone: '1' } },
      ]),
    );

    await service.startImport(
      csv(`${HEADER}\nA,1,2,COD`),
      body(VALID_MAPPING, 'Complaints'),
    );
    await Promise.resolve();

    const context = (persistValid.mock.calls[0] as unknown[])[2];
    expect(context).toMatchObject({
      jobId: 'job-1',
      pipeline: 'Complaints',
      defaultStatus: 'New',
    });
  });

  it('takes the default status from the prepared run', async () => {
    const { service, evaluate, persistValid, prepare } = makeService();
    prepare.mockResolvedValue({
      fields: LEADS_IMPORT_FIELDS,
      defaultStatus: 'Open',
    });
    evaluate.mockResolvedValue(evalResult([{ status: 'valid' }]));

    await service.startImport(
      csv(`${HEADER}
A,1,2,COD`),
      body(VALID_MAPPING),
    );
    await Promise.resolve();

    expect((persistValid.mock.calls[0] as unknown[])[2]).toMatchObject({
      defaultStatus: 'Open',
    });
  });

  it('rejects a file with no data rows', async () => {
    const { service } = makeService();
    await expect(
      service.startImport(csv(HEADER), body(VALID_MAPPING)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LeadsImportService.getJob', () => {
  it('throws NotFound when the job is out of scope or missing', async () => {
    const { service, findScoped } = makeService();
    findScoped.mockResolvedValue(null);
    await expect(
      service.getJob('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LeadsImportService.sample', () => {
  it('heads the CSV template with every import field label, in catalog order', async () => {
    const { service } = makeService();
    const file = await service.sample('csv');
    const [header, first] = file
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split('\r\n');
    expect(header).toBe(LEADS_IMPORT_FIELDS.map((f) => f.label).join(','));
    // Spaced so Excel keeps the digits as text instead of 9.71501E+11.
    expect(first.startsWith('Ahmed Ali,971 501234567,')).toBe(true);
  });
});

describe('LeadsImportService — a batch that fails part-way', () => {
  it('records what landed and reports every unwritten row, so the counts add up', async () => {
    const { service, evaluate, persistValid, update } = makeService();
    evaluate.mockResolvedValue(
      evalResult([
        { status: 'valid' },
        { status: 'valid' },
        { status: 'valid' },
        {
          status: 'invalid',
          error: { reason: 'bad', errorCode: 'INVALID_PHONE' },
        },
      ]),
    );
    // The first batch commits, then its progress write fails.
    persistValid.mockImplementation(
      async (
        _rows: unknown,
        _descriptor: unknown,
        _context: unknown,
        onProgress: (n: number) => Promise<void>,
      ) => {
        await onProgress(1);
        return 1;
      },
    );
    update.mockRejectedValueOnce(new Error('connection dropped'));

    await service.startImport(
      csv(`${HEADER}\nA,1,2,COD\nB,1,2,COD\nC,1,2,COD\nD,x,2,COD`),
      body(VALID_MAPPING),
    );
    // The write runs in the background after the response; drain it fully.
    await new Promise((resolve) => setImmediate(resolve));

    const failed = (update.mock.calls as unknown[][]).at(-1)?.[1] as {
      status: string;
      importedCount: number;
      processedRows: number;
      failedCount: number;
      errors: { rowNumber: number; errorCode: string }[];
    };
    expect(failed).toMatchObject({
      status: 'FAILED',
      importedCount: 1,
      processedRows: 4,
      failedCount: 3,
    });
    expect(failed.errors.map((e) => [e.rowNumber, e.errorCode])).toEqual([
      [5, 'INVALID_PHONE'],
      [3, 'NOT_IMPORTED'],
      [4, 'NOT_IMPORTED'],
    ]);
  });
});

describe('toImportJobResponse', () => {
  const NOW = '2026-10-09T10:00:00.000Z';
  const row = (status: string, minutesSinceUpdate: number) => ({
    id: 'job-1',
    module: 'leads',
    status,
    fileName: 'leads.csv',
    pipeline: 'Lead Pipeline',
    totalRows: 1,
    processedRows: 0,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date(Date.parse(NOW) - minutesSinceUpdate * 60_000),
    createdBy: null,
  });

  it('reads a PROCESSING job with no progress for over 2 minutes as FAILED', () => {
    const now = new Date(NOW);
    expect(toImportJobResponse(row('PROCESSING', 3), now).status).toBe(
      'FAILED',
    );
    expect(toImportJobResponse(row('PROCESSING', 1), now).status).toBe(
      'PROCESSING',
    );
    expect(toImportJobResponse(row('COMPLETED', 60), now).status).toBe(
      'COMPLETED',
    );
  });
});

describe('LeadsImportService — a duplicate row is imported, not skipped (ADR-0092)', () => {
  const rows = () =>
    evalResult([
      { status: 'valid' },
      {
        status: 'duplicate',
        error: { reason: 'dup', errorCode: 'DUPLICATE_EXISTING' },
      },
      {
        status: 'invalid',
        error: { reason: 'bad', errorCode: 'INVALID_PHONE' },
      },
    ]);
  const file = () => csv(`${HEADER}\nA,1,2,COD\nB,1,2,COD\nC,x,2,COD`);

  it('counts nothing as skipped and settles only the invalid row up front', async () => {
    const { service, evaluate, create } = makeService(
      UserRole.SUPERADMIN,
      true,
    );
    evaluate.mockResolvedValue(rows());

    await service.startImport(file(), body(VALID_MAPPING));

    const created = (create.mock.calls as unknown[][])[0][0] as {
      skippedCount: number;
      failedCount: number;
      processedRows: number;
      totalRows: number;
    };
    expect(created.skippedCount).toBe(0);
    expect(created.failedCount).toBe(1);
    expect(created.processedRows).toBe(1);
    expect(created.totalRows).toBe(3);
  });

  it('leaves the imported duplicate out of the failed/skipped report, listing only the invalid row', async () => {
    const { service, evaluate, create } = makeService(
      UserRole.SUPERADMIN,
      true,
    );
    evaluate.mockResolvedValue(rows());

    await service.startImport(file(), body(VALID_MAPPING));

    const created = (create.mock.calls as unknown[][])[0][0] as {
      errors: { rowNumber: number; errorCode: string }[];
    };
    expect(created.errors.map((e) => [e.rowNumber, e.errorCode])).toEqual([
      [4, 'INVALID_PHONE'],
    ]);
  });

  it('still skips and reports duplicates for a descriptor that does not import them', async () => {
    const { service, evaluate, create } = makeService(
      UserRole.SUPERADMIN,
      false,
    );
    evaluate.mockResolvedValue(rows());

    await service.startImport(file(), body(VALID_MAPPING));

    const created = (create.mock.calls as unknown[][])[0][0] as {
      skippedCount: number;
      errors: { errorCode: string }[];
    };
    expect(created.skippedCount).toBe(1);
    expect(created.errors.map((e) => e.errorCode)).toEqual([
      'DUPLICATE_EXISTING',
      'INVALID_PHONE',
    ]);
  });

  it('reconciles a failed run over the rows it meant to write, duplicates included', async () => {
    const { service, evaluate, persistValid, update } = makeService(
      UserRole.SUPERADMIN,
      true,
    );
    evaluate.mockResolvedValue(rows());
    persistValid.mockImplementation(
      async (
        _rows: unknown,
        _descriptor: unknown,
        _context: unknown,
        onProgress: (n: number) => Promise<void>,
      ) => {
        await onProgress(1);
        return 1;
      },
    );
    update.mockRejectedValueOnce(new Error('connection dropped'));

    await service.startImport(file(), body(VALID_MAPPING));
    await new Promise((resolve) => setImmediate(resolve));

    const failed = (update.mock.calls as unknown[][]).at(-1)?.[1] as {
      status: string;
      importedCount: number;
      failedCount: number;
      errors: { rowNumber: number; errorCode: string }[];
    };
    expect(failed).toMatchObject({
      status: 'FAILED',
      importedCount: 1,
      // The invalid row plus the one writable row (the duplicate) that never landed.
      failedCount: 2,
    });
    expect(failed.errors.map((e) => [e.rowNumber, e.errorCode])).toEqual([
      [4, 'INVALID_PHONE'],
      [3, 'NOT_IMPORTED'],
    ]);
  });
});

/*
  A row that would arrive WON — by its own Lead Status, or by the pipeline's first stage standing in
  for a blank one — would be a converted lead, and a converted lead's order needs a delivery date
  (client, 2026-10-17) that import has no column for yet. Each such row is a row error of its own;
  every other row imports as before, and no batch fails for it.
*/
describe('LeadsImportService — rows that would convert', () => {
  const won = { status: 'valid' as const, mapped: { status: 'WON' } };
  const fresh = { status: 'valid' as const, mapped: { status: 'New' } };
  const blank = { status: 'valid' as const, mapped: {} };

  it('refuses a WON row with a row error and keeps the rest valid, in the counts too', async () => {
    const { service, evaluate } = makeService();
    evaluate.mockResolvedValue(evalResult([fresh, won]));

    const result = await service.validate(
      csv(`${HEADER}\nA,1,2,COD\nB,1,2,COD`),
      body(VALID_MAPPING),
    );

    expect(result).toMatchObject({ total: 2, valid: 1, invalid: 1 });
    expect(result.rows[0]).toMatchObject({
      status: 'invalid',
      error: { errorCode: 'INVALID_OPTION' },
    });
    expect(result.rows[0].error?.reason).toContain(
      'Lead Status WON converts the lead, and a converted lead needs a Delivery Date',
    );
    expect(result.rows[1].status).toBe('valid');
  });

  it('refuses a blank-status row when the pipeline starts at WON, and keeps rows with their own status', async () => {
    const { service, evaluate } = makeService(
      UserRole.SUPERADMIN,
      false,
      'WON',
    );
    evaluate.mockResolvedValue(evalResult([blank, fresh]));

    const result = await service.validate(
      csv(`${HEADER}\nA,1,2,COD\nB,1,2,COD`),
      body(VALID_MAPPING),
    );

    expect(result).toMatchObject({ total: 2, valid: 1, invalid: 1 });
    expect(result.rows[0].error?.reason).toContain(
      'Lead Status is blank, so the row would take the pipeline’s first stage, WON',
    );
  });

  it('refuses a WON duplicate too, though duplicates are otherwise imported', async () => {
    const { service, evaluate } = makeService(UserRole.SUPERADMIN, true);
    evaluate.mockResolvedValue(
      evalResult([
        {
          status: 'duplicate',
          mapped: { status: 'WON' },
          error: { reason: 'dup', errorCode: 'DUPLICATE_EXISTING' },
        },
      ]),
    );

    const result = await service.validate(
      csv(`${HEADER}\nA,1,2,COD`),
      body(VALID_MAPPING),
    );

    expect(result).toMatchObject({ invalid: 1, duplicates: 0 });
  });

  it('settles a WON row as failed up front and never hands it to the batch writer', async () => {
    const { service, evaluate, create, persistValid } = makeService();
    evaluate.mockResolvedValue(evalResult([fresh, won]));

    await service.startImport(
      csv(`${HEADER}\nA,1,2,COD\nB,1,2,COD`),
      body(VALID_MAPPING),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ totalRows: 2, failedCount: 1 }),
    );
    // The writer is handed every row and writes only the writable ones; the WON row is not.
    await new Promise((resolve) => setImmediate(resolve));
    const [rows] = persistValid.mock.calls[0] as [EvaluatedRow[]];
    expect(
      new ImportEngineService()
        .writable(rows, { importsDuplicates: false })
        .map((row) => row.mapped.status),
    ).toEqual(['New']);
  });
});
