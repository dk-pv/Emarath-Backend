import { PrismaService } from '../../prisma/prisma.service';
import { userActor } from '../../audit/audit-events';
import { LeadsImportRepository, PreparedLead } from './leads-import.repository';

const LEAD_A = '11111111-1111-1111-1111-111111111111';
const LEAD_B = '22222222-2222-2222-2222-222222222222';

/** A row shaped like the audit select (ADR-0083) — only what the log compares. */
function auditRow(id: string, assigneeIds: string[] = []) {
  return {
    id,
    status: 'New',
    lostReason: null,
    pipeline: 'Lead Pipeline',
    deletedAt: null,
    assignments: assigneeIds.map((userId) => ({ userId })),
    tags: [],
    customFieldValues: [],
    complaints: [],
  };
}

const record = (id: string, assignToUserId: string | null): PreparedLead => ({
  data: {
    id,
    name: 'Imported',
    primaryPhone: id.slice(0, 12),
    status: 'New',
    pipeline: 'Lead Pipeline',
  },
  assignToUserId,
});

function makeRepository() {
  const leadCreateMany = jest.fn().mockResolvedValue({ count: 2 });
  const assignmentCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const auditFindMany = jest.fn();
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = {
    lead: { createMany: leadCreateMany, findMany: auditFindMany },
    leadAssignment: { createMany: assignmentCreateMany },
    auditEvent: { createMany: auditCreateMany },
    // The conversion hook (ADR-0085): `createManyAndReturn` echoes what it was asked to
    // insert, so a lead that becomes WON gets an order id on its CONVERTED event.
    logisticsOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      createManyAndReturn: jest.fn((args: { data: { leadId: string }[] }) =>
        Promise.resolve(
          args.data.map((row, index) => ({
            id: `order-${index + 1}`,
            leadId: row.leadId,
            orderNumber: 1000 + index,
            status: 'INITIAL',
          })),
        ),
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  } as unknown as PrismaService;
  return {
    repository: new LeadsImportRepository(prisma),
    leadCreateMany,
    auditFindMany,
    auditCreateMany,
  };
}

const audit = {
  actor: userActor({ id: 'agent-1' }),
  source: 'leads.import',
  metadata: { importJobId: 'job-1' },
};

describe('LeadsImportRepository.insertLeads — audit (ADR-0083)', () => {
  it('records every lead in the batch as created by this import, in the batch’s transaction', async () => {
    const { repository, auditFindMany, auditCreateMany } = makeRepository();
    auditFindMany.mockResolvedValue([
      auditRow(LEAD_A, ['agent-1']),
      auditRow(LEAD_B),
    ]);

    await repository.insertLeads(
      [record(LEAD_A, 'agent-1'), record(LEAD_B, null)],
      audit,
    );

    const findArgs = (auditFindMany.mock.calls[0] as [{ where: unknown }])[0];
    expect(findArgs.where).toEqual({ id: { in: [LEAD_A, LEAD_B] } });
    const rows = (auditCreateMany.mock.calls[0] as [{ data: unknown[] }])[0]
      .data;
    expect(rows).toMatchObject([
      {
        entityId: LEAD_A,
        action: 'CREATED',
        actorId: 'agent-1',
        source: 'leads.import',
        metadata: { importJobId: 'job-1' },
      },
      { entityId: LEAD_A, action: 'ASSIGNED' },
      { entityId: LEAD_B, action: 'CREATED' },
    ]);
  });

  /*
    An import row whose Lead Status column reads WON is stored as WON like any other value —
    it is never checked against the stage catalogue — and converts like every other WON path
    (ADR-0085 A2 path 7): the batch's transaction creates its Logistics order and records the
    CONVERTED event beside CREATED, with the order named on the conversion alone.
  */
  it('converts an imported WON row inside the batch’s transaction', async () => {
    const { repository, auditFindMany, auditCreateMany } = makeRepository();
    auditFindMany.mockResolvedValue([{ ...auditRow(LEAD_A), status: 'WON' }]);

    await repository.insertLeads([record(LEAD_A, null)], audit);

    const rows = (
      auditCreateMany.mock.calls[0] as [
        { data: { action: string; entityType: string }[] },
      ]
    )[0].data;
    expect(rows).toMatchObject([
      { entityId: LEAD_A, action: 'CREATED', after: { status: 'WON' } },
      {
        entityId: LEAD_A,
        action: 'CONVERTED',
        after: { status: 'WON' },
        metadata: { importJobId: 'job-1', orderId: 'order-1' },
      },
      { entityType: 'LOGISTICS_ORDER', action: 'CREATED', leadId: LEAD_A },
    ]);
  });

  it('leaves an imported row in any other status unconverted', async () => {
    const { repository, auditFindMany, auditCreateMany } = makeRepository();
    auditFindMany.mockResolvedValue([auditRow(LEAD_A)]);

    await repository.insertLeads([record(LEAD_A, null)], audit);

    const rows = (
      auditCreateMany.mock.calls[0] as [{ data: { action: string }[] }]
    )[0].data;
    expect(rows.map((row) => row.action)).toEqual(['CREATED']);
  });

  it('records nothing when the batch insert fails', async () => {
    const { repository, leadCreateMany, auditCreateMany } = makeRepository();
    leadCreateMany.mockRejectedValue(new Error('duplicate key'));

    await expect(
      repository.insertLeads([record(LEAD_A, null)], audit),
    ).rejects.toThrow('duplicate key');
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});
