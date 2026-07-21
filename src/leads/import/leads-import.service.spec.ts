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

const csv = (body: string) => {
  const buffer = Buffer.from(body, 'utf8');
  return { originalname: 'leads.csv', buffer, size: buffer.length };
};

/** A mapping that satisfies the four required fields. */
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

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  // Held as locals (not read off the mocks) so the assertions never reference an
  // unbound class method — the pattern leads.service.spec uses.
  const evaluate = jest.fn();
  const persistValid = jest.fn().mockResolvedValue(0);
  const create = jest.fn().mockResolvedValue({ id: 'job-1' });
  const update = jest.fn().mockResolvedValue(undefined);
  const findScoped = jest.fn();

  const engine = { evaluate, persistValid } as unknown as ImportEngineService;

  const descriptor = {
    module: 'leads',
    fields: LEADS_IMPORT_FIELDS,
    dedupeField: 'primaryPhone',
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
  return { service, evaluate, persistValid, create, update, findScoped };
}

const body = (mapping: string, pipeline = 'Lead Pipeline'): ImportBodyDto => ({
  mapping,
  pipeline,
});

describe('LeadsImportService.fields', () => {
  it('returns the catalog with the four required fields flagged', () => {
    const { service } = makeService();
    const { fields } = service.fields();
    const required = fields.filter((f) => f.required).map((f) => f.value);
    expect(required).toEqual([
      'name',
      'primaryPhone',
      'actualAmount',
      'paymentMethod',
    ]);
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
    expect(result.rows[1].error?.errorCode).toBe('INVALID_NUMBER');
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
