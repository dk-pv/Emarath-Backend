import { Prisma } from '../generated/prisma/client';
import { AuditEventInput, recordAuditEvents, userActor } from './audit-events';

function makeClient() {
  const createMany = jest.fn().mockReturnValue('prisma-promise');
  const client = {
    auditEvent: { createMany },
  } as unknown as Prisma.TransactionClient;
  return { client, createMany };
}

const base: AuditEventInput = {
  entityType: 'LEAD',
  entityId: 'lead-1',
  leadId: 'lead-1',
  action: 'STATUS_CHANGED',
  actor: userActor({ id: 'user-1' }),
  source: 'leads.status',
  before: { status: 'New' },
  after: { status: 'WON' },
};

describe('recordAuditEvents', () => {
  it('stores a person as USER with their id, plus before/after/metadata as given', () => {
    const { client, createMany } = makeClient();

    void recordAuditEvents(client, [{ ...base, metadata: { note: 'x' } }]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          entityType: 'LEAD',
          entityId: 'lead-1',
          leadId: 'lead-1',
          action: 'STATUS_CHANGED',
          actorType: 'USER',
          actorId: 'user-1',
          source: 'leads.status',
          before: { status: 'New' },
          after: { status: 'WON' },
          metadata: { note: 'x' },
        },
      ],
    });
  });

  it('represents automations and integrations without a user', () => {
    const { client, createMany } = makeClient();

    void recordAuditEvents(client, [
      { ...base, actor: { type: 'SYSTEM' }, source: 'qc-writeback' },
      { ...base, actor: { type: 'INTEGRATION' }, source: 'double-tick' },
    ]);

    const rows = (createMany.mock.calls[0] as [{ data: unknown[] }])[0].data;
    expect(rows).toMatchObject([
      { actorType: 'SYSTEM', actorId: null, source: 'qc-writeback' },
      { actorType: 'INTEGRATION', actorId: null, source: 'double-tick' },
    ]);
  });

  it('returns the unawaited Prisma promise, so it can join an array transaction', () => {
    const { client } = makeClient();
    expect(recordAuditEvents(client, [base])).toBe('prisma-promise');
  });
});
