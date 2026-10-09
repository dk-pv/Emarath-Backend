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
    dedupeKeys: (mapped) => (mapped.phone ? [`phone ${mapped.phone}`] : []),
    findExistingDuplicates: (keys) =>
      Promise.resolve(
        new Set(keys.filter((key) => existing.includes(key.slice(6)))),
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
    { rowNumber: 2, cells: ['Alice', '111', '100'] }, // valid
    { rowNumber: 3, cells: ['', '222', '100'] }, // invalid — name required
    { rowNumber: 4, cells: ['Bob', '111', '50'] }, // duplicate of Alice's phone (in file)
    { rowNumber: 5, cells: ['Carol', '999', 'x'] }, // invalid — amount not a number
    { rowNumber: 7, cells: ['Dave', '777', '10'] }, // existing phone; row 6 was blank
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
    expect(rows[2].error).toEqual({
      errorCode: 'DUPLICATE_IN_FILE',
      reason: 'A row earlier in the file has the same phone 111',
    });
    expect(rows[3].error?.errorCode).toBe('INVALID_NUMBER');
    expect(rows[4].error).toEqual({
      errorCode: 'DUPLICATE_EXISTING',
      reason: 'A lead with phone 777 already exists',
    });
  });

  it('keeps each row’s own row number and original values', async () => {
    const { descriptor } = makeDescriptor();
    const { rows } = await engine.evaluate(SHEET, MAPPING, descriptor);
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 3, 4, 5, 7]);
    expect(rows[0].values).toEqual({
      Name: 'Alice',
      Phone: '111',
      Amount: '100',
    });
  });

  it('validates against the run’s fields when given, not the catalog', async () => {
    const { descriptor } = makeDescriptor();
    const sheet: ParsedSheet = {
      headers: ['Name', 'Phone', 'Tier'],
      rows: [
        { rowNumber: 2, cells: ['Alice', '111', 'gold'] },
        { rowNumber: 3, cells: ['Bob', '222', 'Bronze'] },
      ],
    };
    const fields: ImportField[] = [
      ...FIELDS,
      { value: 'tier', label: 'Tier', type: 'string', options: ['Gold'] },
    ];

    const { rows } = await engine.evaluate(
      sheet,
      { Name: 'name', Phone: 'phone', Tier: 'tier' },
      descriptor,
      fields,
    );

    expect(rows[0].mapped.tier).toBe('Gold');
    expect(rows[1].error?.errorCode).toBe('INVALID_OPTION');
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
