import { ImportEngineService } from './import-engine.service';
import { ImportDescriptor, ImportField } from './import-descriptor';
import { ParsedSheet } from './spreadsheet-parser';

const FIELDS: ImportField[] = [
  { value: 'name', label: 'Name', type: 'string', required: true },
  { value: 'phone', label: 'Phone', type: 'string', required: true },
  { value: 'amount', label: 'Amount', type: 'decimal' },
];

/** A minimal descriptor whose persistence just records the batches it is handed. */
function makeDescriptor(existing: string[] = []): {
  descriptor: ImportDescriptor<Record<string, string>, undefined>;
  batches: Record<string, string>[][];
} {
  const batches: Record<string, string>[][] = [];
  const descriptor: ImportDescriptor<Record<string, string>, undefined> = {
    module: 'test',
    fields: FIELDS,
    dedupeField: 'phone',
    findExistingDuplicates: (values) =>
      Promise.resolve(
        new Set(values.filter((value) => existing.includes(value))),
      ),
    buildRecord: (mapped) => mapped,
    persistBatch: (records) => {
      batches.push(records);
      return Promise.resolve();
    },
  };
  return { descriptor, batches };
}

const SHEET: ParsedSheet = {
  headers: ['Name', 'Phone', 'Amount'],
  rows: [
    ['Alice', '111', '100'], // valid
    ['', '222', '100'], // invalid — name required
    ['Bob', '111', '50'], // duplicate of Alice's phone (in file)
    ['Carol', '999', 'x'], // invalid — amount not a number
    ['Dave', '777', '10'], // duplicate of an existing phone
  ],
};

const MAPPING = { Name: 'name', Phone: 'phone', Amount: 'amount' };

describe('ImportEngineService.evaluate', () => {
  const engine = new ImportEngineService();

  it('classifies valid, invalid, in-file and existing duplicates', async () => {
    const { descriptor } = makeDescriptor(['777']);
    const { rows, summary } = await engine.evaluate(SHEET, MAPPING, descriptor);

    expect(summary).toEqual({ total: 5, valid: 1, invalid: 2, duplicates: 2 });

    expect(rows[0].status).toBe('valid');
    expect(rows[1].error?.errorCode).toBe('REQUIRED_FIELD_MISSING');
    expect(rows[2].error?.errorCode).toBe('DUPLICATE_IN_FILE');
    expect(rows[3].error?.errorCode).toBe('INVALID_NUMBER');
    expect(rows[4].error?.errorCode).toBe('DUPLICATE_EXISTING');
  });

  it('numbers rows from 2 (the header is row 1) and keeps original values', async () => {
    const { descriptor } = makeDescriptor();
    const { rows } = await engine.evaluate(SHEET, MAPPING, descriptor);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].values).toEqual({
      Name: 'Alice',
      Phone: '111',
      Amount: '100',
    });
  });
});

describe('ImportEngineService.persistValid', () => {
  const engine = new ImportEngineService();

  it('persists only valid rows and reports progress', async () => {
    const { descriptor, batches } = makeDescriptor(['777']);
    const { rows } = await engine.evaluate(SHEET, MAPPING, descriptor);

    const progress: number[] = [];
    const imported = await engine.persistValid(
      rows,
      descriptor,
      undefined,
      (soFar) => {
        progress.push(soFar);
        return Promise.resolve();
      },
    );

    expect(imported).toBe(1);
    expect(batches).toEqual([[{ name: 'Alice', phone: '111', amount: '100' }]]);
    expect(progress).toEqual([1]);
  });
});
