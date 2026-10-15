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
    // No existing lead matches: these tests are about the audit trail, not duplicates.
    lead: { findMany: jest.fn().mockResolvedValue([]) },
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
    An import row whose Lead Status column reads WON (any case — the import stores the stage's
    own spelling, ADR-0088) is stored as WON and converts like every other WON path
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

describe('LeadsImportRepository.existingContacts', () => {
  function makeLookup(rows: { phone: object[]; email: object[] }) {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(rows.phone)
      .mockResolvedValueOnce(rows.email);
    const prisma = { lead: { findMany } } as unknown as PrismaService;
    return { repository: new LeadsImportRepository(prisma), findMany };
  }

  it('matches a phone in either phone column and an email ignoring case', async () => {
    const { repository, findMany } = makeLookup({
      phone: [{ primaryPhone: '971500000001', secondaryPhone: '971500000002' }],
      email: [{ email: 'Ali@Example.com' }],
    });

    const found = await repository.existingContacts(
      ['971500000002'],
      ['ali@example.com'],
      false,
    );

    const [phoneArgs, emailArgs] = findMany.mock.calls.map(
      (call) => (call as [{ where: unknown }])[0].where,
    );
    expect(phoneArgs).toEqual({
      deletedAt: null,
      OR: [
        { primaryPhone: { in: ['971500000002'] } },
        { secondaryPhone: { in: ['971500000002'] } },
      ],
    });
    expect(emailArgs).toEqual({
      deletedAt: null,
      email: { in: ['ali@example.com'], mode: 'insensitive' },
    });
    expect(found.phones).toEqual(new Set(['971500000001', '971500000002']));
    expect(found.emails).toEqual(new Set(['ali@example.com']));
  });

  it('includes archived leads when Duplicate Settings says so', async () => {
    const { repository, findMany } = makeLookup({ phone: [], email: [] });
    await repository.existingContacts(['971500000001'], [], true);
    const where = (findMany.mock.calls[0] as [{ where: object }])[0].where;
    expect(where).not.toHaveProperty('deletedAt');
  });
});

describe('LeadsImportRepository.insertLeads — duplicate relationship (ADR-0092)', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));
  const existingLead = (over: Record<string, unknown> = {}) => ({
    id: 'orig-1',
    createdAt: day(1),
    duplicateOfId: null,
    primaryPhone: '971500000001',
    secondaryPhone: null,
    email: null,
    ...over,
  });
  const row = (
    id: string,
    over: Record<string, unknown> = {},
  ): PreparedLead => ({
    data: {
      id,
      name: 'Imported',
      primaryPhone: '971599999999',
      status: 'New',
      pipeline: 'Lead Pipeline',
      ...over,
    },
    assignToUserId: null,
  });

  /** A repository whose lookups answer from `existing`, and which records what it writes. */
  function makeKit(existing: object[] = []) {
    const leadFindMany = jest.fn().mockResolvedValue(existing);
    const leadCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const auditCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      lead: {
        createMany: leadCreateMany,
        findMany: jest.fn().mockResolvedValue([]),
      },
      leadAssignment: { createMany: jest.fn() },
      auditEvent: { createMany: auditCreateMany },
      logisticsOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        createManyAndReturn: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      lead: { findMany: leadFindMany },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
        run(tx),
      ),
    } as unknown as PrismaService;
    const repository = new LeadsImportRepository(prisma);
    const written = () =>
      Object.fromEntries(
        (
          leadCreateMany.mock.calls[0] as [
            { data: { id: string; duplicateOfId: string | null }[] },
          ]
        )[0].data.map((lead) => [lead.id, lead.duplicateOfId]),
      );
    return { repository, leadFindMany, leadCreateMany, written };
  }

  it('writes a row that matches an existing lead, linked to it — never skipped', async () => {
    const { repository, written } = makeKit([existingLead()]);

    await repository.insertLeads(
      [row('new-1', { primaryPhone: '971500000001' })],
      audit,
    );

    expect(written()).toEqual({ 'new-1': 'orig-1' });
  });

  it('writes a row with no match unlinked', async () => {
    const { repository, written } = makeKit([]);

    await repository.insertLeads([row('new-1')], audit);

    expect(written()).toEqual({ 'new-1': null });
  });

  it('matches across the two phone columns', async () => {
    const { repository, written } = makeKit([
      existingLead({
        primaryPhone: '971500000009',
        secondaryPhone: '971500000001',
      }),
    ]);

    await repository.insertLeads(
      [row('new-1', { primaryPhone: '971500000001' })],
      audit,
    );

    expect(written()).toEqual({ 'new-1': 'orig-1' });
  });

  it('matches an email ignoring case', async () => {
    const { repository, written } = makeKit([
      existingLead({ primaryPhone: '971500000009', email: 'Ali@Example.com' }),
    ]);

    await repository.insertLeads(
      [row('new-1', { email: 'ali@example.com' })],
      audit,
    );

    expect(written()).toEqual({ 'new-1': 'orig-1' });
  });

  it('links a later row of the same batch to the earlier one it duplicates', async () => {
    const { repository, written } = makeKit([]);

    await repository.insertLeads(
      [
        row('first', { primaryPhone: '971500000005' }),
        row('second', { primaryPhone: '971500000005' }),
      ],
      audit,
    );

    // The first row is the original; only the second is a duplicate. No self-link.
    expect(written()).toEqual({ first: null, second: 'first' });
  });

  it('keeps one customer’s rows in a star around the first, not a chain', async () => {
    const { repository, written } = makeKit([]);

    await repository.insertLeads(
      [
        row('r1', { primaryPhone: '971500000005' }),
        row('r2', { primaryPhone: '971500000005' }),
        row('r3', { primaryPhone: '971500000005' }),
      ],
      audit,
    );

    expect(written()).toEqual({ r1: null, r2: 'r1', r3: 'r1' });
  });

  it('prefers an existing lead over an earlier row of the batch', async () => {
    const { repository, written } = makeKit([existingLead()]);

    await repository.insertLeads(
      [
        row('r1', { primaryPhone: '971500000001' }),
        row('r2', { primaryPhone: '971500000001' }),
      ],
      audit,
    );

    expect(written()).toEqual({ r1: 'orig-1', r2: 'orig-1' });
  });

  it('chooses the oldest existing match that is not itself a duplicate', async () => {
    const { repository, written } = makeKit([
      existingLead({ id: 'dup', createdAt: day(1), duplicateOfId: 'other' }),
      existingLead({ id: 'root-late', createdAt: day(9) }),
      existingLead({ id: 'root-early', createdAt: day(4) }),
    ]);

    await repository.insertLeads(
      [row('new-1', { primaryPhone: '971500000001' })],
      audit,
    );

    expect(written()).toEqual({ 'new-1': 'root-early' });
  });

  it('matches through either of a row’s own phones', async () => {
    const { repository, written } = makeKit([
      existingLead({ primaryPhone: '971500000002' }),
    ]);

    await repository.insertLeads(
      [
        row('new-1', {
          primaryPhone: '971500000099',
          secondaryPhone: '971500000002',
        }),
      ],
      audit,
    );

    expect(written()).toEqual({ 'new-1': 'orig-1' });
  });

  it('excludes archived leads from the lookup unless Duplicate Settings includes them', async () => {
    const live = makeKit([]);
    await live.repository.insertLeads([row('new-1')], audit, false);
    const archivedIncluded = makeKit([]);
    await archivedIncluded.repository.insertLeads([row('new-1')], audit, true);

    const whereOf = (kit: ReturnType<typeof makeKit>) =>
      (kit.leadFindMany.mock.calls[0] as [{ where: object }])[0].where;
    expect(whereOf(live)).toHaveProperty('deletedAt', null);
    expect(whereOf(archivedIncluded)).not.toHaveProperty('deletedAt');
  });

  it('writes every row of the batch, so the created count equals the rows given', async () => {
    const { repository, leadCreateMany } = makeKit([existingLead()]);

    await repository.insertLeads(
      [
        row('a', { primaryPhone: '971500000001' }),
        row('b'),
        row('c', { primaryPhone: '971500000001' }),
      ],
      audit,
    );

    const data = (leadCreateMany.mock.calls[0] as [{ data: unknown[] }])[0]
      .data;
    expect(data).toHaveLength(3);
  });

  it('does no lookup for an empty batch', async () => {
    const { repository, leadFindMany, leadCreateMany } = makeKit([]);
    await repository.insertLeads([], audit);
    expect(leadFindMany).not.toHaveBeenCalled();
    expect(leadCreateMany).not.toHaveBeenCalled();
  });
});
