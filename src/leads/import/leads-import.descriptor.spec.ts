import { UserRole } from '../../generated/prisma/client';
import { LeadsImportDescriptor } from './leads-import.descriptor';
import { LeadsImportRepository, PreparedLead } from './leads-import.repository';

describe('LeadsImportDescriptor.persistBatch — audit (ADR-0083)', () => {
  it('names the importer as actor and the import job on every created lead', async () => {
    const insertLeads = jest.fn().mockResolvedValue(undefined);
    const descriptor = new LeadsImportDescriptor({
      insertLeads,
    } as unknown as LeadsImportRepository);
    const records = [{ data: { id: 'lead-1' } }] as unknown as PreparedLead[];

    await descriptor.persistBatch(records, {
      pipeline: 'Lead Pipeline',
      defaultStatus: 'New',
      user: { id: 'agent-1', role: UserRole.SALES_AGENT },
      jobId: 'job-1',
    });

    expect(insertLeads).toHaveBeenCalledWith(records, {
      actor: { type: 'USER', id: 'agent-1' },
      source: 'leads.import',
      metadata: { importJobId: 'job-1' },
    });
  });
});
