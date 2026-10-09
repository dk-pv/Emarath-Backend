import { UserRole } from '../../generated/prisma/client';
import { ImportEngineService } from '../../common/import/import-engine.service';
import { buildSampleFile } from '../../common/import/sample-file';
import { parseSpreadsheet } from '../../common/import/spreadsheet-parser';
import { LookupsService } from '../../lookups/lookups.service';
import { SettingsService } from '../../settings/settings.service';
import { StagesService } from '../../stages/stages.service';
import { LeadsImportDescriptor } from './leads-import.descriptor';
import { LEADS_IMPORT_FIELDS } from './leads-import.fields';
import { LeadsImportRepository, PreparedLead } from './leads-import.repository';

const LOOKUPS: Record<string, string[]> = {
  pipelines: ['Lead Pipeline', 'Complaints'],
  sources: ['Facebook', 'Website'],
  categories: ['Default'],
  products: ['MUKHALAT EMARATI'],
  paymentMethods: ['COD', 'Tabby'],
  callStatus: ['Answered'],
  languages: ['English', 'Arabic'],
};

function makeDescriptor(stages: Record<string, string[]> = {}) {
  const insertLeads = jest.fn().mockResolvedValue(undefined);
  const existingContacts = jest.fn().mockResolvedValue({
    phones: new Set<string>(),
    emails: new Set<string>(),
  });
  const getSalesCrmDuplicate = jest
    .fn()
    .mockResolvedValue({ checkArchivedLeads: false });

  const descriptor = new LeadsImportDescriptor(
    { insertLeads, existingContacts } as unknown as LeadsImportRepository,
    {
      byType: (type: string) =>
        Promise.resolve(
          (LOOKUPS[type] ?? []).map((value) => ({ value, label: value })),
        ),
    } as unknown as LookupsService,
    {
      list: (pipeline: string) =>
        Promise.resolve((stages[pipeline] ?? []).map((name) => ({ name }))),
    } as unknown as StagesService,
    { getSalesCrmDuplicate } as unknown as SettingsService,
  );
  return { descriptor, insertLeads, existingContacts, getSalesCrmDuplicate };
}

const context = (role: UserRole) => ({
  pipeline: 'Lead Pipeline',
  defaultStatus: 'New',
  user: { id: 'user-1', role },
  jobId: 'job-1',
});

describe('LeadsImportDescriptor.sampleRows', () => {
  it('builds a template that imports as written, as CSV and as XLSX', async () => {
    const { descriptor } = makeDescriptor({ 'Lead Pipeline': ['New', 'HOT'] });
    const run = await descriptor.prepare('Lead Pipeline');
    const rows = await descriptor.sampleRows();

    for (const format of ['csv', 'xlsx'] as const) {
      const buffer = await buildSampleFile(LEADS_IMPORT_FIELDS, rows, format);
      const sheet = await parseSpreadsheet({
        originalname: `sample.${format}`,
        buffer,
        size: buffer.length,
      });
      // The wizard's auto-map: a header is mapped by its exact field label.
      const mapping = Object.fromEntries(
        sheet.headers.map((header) => [
          header,
          LEADS_IMPORT_FIELDS.find((field) => field.label === header)?.value ??
            null,
        ]),
      );
      const { summary } = await new ImportEngineService().evaluate(
        sheet,
        mapping,
        descriptor,
        run.fields,
      );
      expect(summary).toEqual({
        total: 2,
        valid: 2,
        invalid: 0,
        duplicates: 0,
      });
    }
  });
});

describe('LeadsImportDescriptor.prepare', () => {
  it('fills each dropdown field with the values the New Lead form offers', async () => {
    const { descriptor } = makeDescriptor({ 'Lead Pipeline': ['New', 'HOT'] });
    const run = await descriptor.prepare('Lead Pipeline');

    const options = (value: string) =>
      run.fields.find((field) => field.value === value)?.options;
    expect(run.defaultStatus).toBe('New');
    expect(options('status')).toEqual(['New', 'HOT']);
    expect(options('source')).toEqual(['Facebook', 'Website']);
    expect(options('product2')).toEqual(['MUKHALAT EMARATI']);
    expect(options('paymentMethod')).toEqual(['COD', 'Tabby']);
    expect(options('name')).toBeUndefined();
  });

  it('refuses a pipeline that does not exist', async () => {
    const { descriptor } = makeDescriptor({ Ghost: ['New'] });
    await expect(descriptor.prepare('Ghost')).rejects.toThrow(
      'Pipeline "Ghost" does not exist.',
    );
  });

  it('refuses a pipeline with no stages — its leads would sit in no Kanban column', async () => {
    const { descriptor } = makeDescriptor();
    await expect(descriptor.prepare('Complaints')).rejects.toThrow(
      'The "Complaints" pipeline has no stages yet.',
    );
  });
});

describe('LeadsImportDescriptor.buildRecord', () => {
  const mapped = { name: 'Ali', primaryPhone: '971501234567' };

  it.each([UserRole.SALES_AGENT, UserRole.SALES_MANAGER])(
    'assigns a %s’s import to them, so they can see what they imported',
    (role) => {
      const { descriptor } = makeDescriptor();
      expect(descriptor.buildRecord(mapped, context(role)).assignToUserId).toBe(
        'user-1',
      );
    },
  );

  it.each([
    UserRole.SUPERADMIN,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])('leaves a %s’s import unassigned (org-wide scope)', (role) => {
    const { descriptor } = makeDescriptor();
    expect(
      descriptor.buildRecord(mapped, context(role)).assignToUserId,
    ).toBeNull();
  });

  it('applies the create defaults: first stage, "Default" category, zero attempts', () => {
    const { descriptor } = makeDescriptor();
    const { data } = descriptor.buildRecord(
      { ...mapped, email: 'ali@example.com' },
      context(UserRole.SUPERADMIN),
    );
    expect(data).toMatchObject({
      status: 'New',
      pipeline: 'Lead Pipeline',
      category: 'Default',
      email: 'ali@example.com',
      callAttempts: 0,
      whatsappAttempts: 0,
    });
  });
});

describe('LeadsImportDescriptor dedupe', () => {
  it('keys a row on both phones and its email, the New Lead duplicate rule', () => {
    const { descriptor } = makeDescriptor();
    expect(
      descriptor.dedupeKeys({
        primaryPhone: '971501234567',
        secondaryPhone: '971551234567',
        email: 'Ali@Example.com',
      }),
    ).toEqual([
      'phone 971501234567',
      'phone 971551234567',
      'email ali@example.com',
    ]);
  });

  it('looks contacts up with the "Check archived leads" setting', async () => {
    const { descriptor, existingContacts, getSalesCrmDuplicate } =
      makeDescriptor();
    getSalesCrmDuplicate.mockResolvedValue({ checkArchivedLeads: true });
    existingContacts.mockResolvedValue({
      phones: new Set(['971501234567']),
      emails: new Set(['ali@example.com']),
    });

    const found = await descriptor.findExistingDuplicates([
      'phone 971501234567',
      'email ali@example.com',
    ]);

    expect(existingContacts).toHaveBeenCalledWith(
      ['971501234567'],
      ['ali@example.com'],
      true,
    );
    expect(found).toEqual(
      new Set(['phone 971501234567', 'email ali@example.com']),
    );
  });
});

describe('LeadsImportDescriptor.persistBatch — audit (ADR-0083)', () => {
  it('names the importer as actor and the import job on every created lead', async () => {
    const { descriptor, insertLeads } = makeDescriptor();
    const records = [{ data: { id: 'lead-1' } }] as unknown as PreparedLead[];

    await descriptor.persistBatch(records, {
      ...context(UserRole.SALES_AGENT),
      user: { id: 'agent-1', role: UserRole.SALES_AGENT },
    });

    expect(insertLeads).toHaveBeenCalledWith(records, {
      actor: { type: 'USER', id: 'agent-1' },
      source: 'leads.import',
      metadata: { importJobId: 'job-1' },
    });
  });
});
