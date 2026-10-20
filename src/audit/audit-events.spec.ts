import { Prisma } from '../generated/prisma/client';
import {
  AuditEventInput,
  recordAfterEffect,
  recordAuditEvents,
  stateChangeEvents,
  userActor,
} from './audit-events';

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

describe('stateChangeEvents (AUD-01)', () => {
  const head = {
    entityType: 'USER' as const,
    entityId: 'user-9',
    leadId: null,
    actor: userActor({ id: 'admin-1' }),
    source: 'users.update',
  };

  it('gives each changed own group its action and everything else one UPDATED, changed fields only', () => {
    const events = stateChangeEvents(
      head,
      { role: 'SALES_AGENT', pipelines: ['A'], jobTitle: 'BDE', phone: '1' },
      { role: 'SALES_MANAGER', pipelines: ['A'], jobTitle: 'Lead', phone: '1' },
      [
        ['ROLE_CHANGED', ['role']],
        ['PERMISSIONS_CHANGED', ['pipelines']],
      ],
    );

    expect(events).toEqual([
      {
        ...head,
        action: 'ROLE_CHANGED',
        before: { role: 'SALES_AGENT' },
        after: { role: 'SALES_MANAGER' },
      },
      {
        ...head,
        action: 'UPDATED',
        before: { jobTitle: 'BDE' },
        after: { jobTitle: 'Lead' },
      },
    ]);
  });

  it('compares lists and objects by value, and an unchanged record yields no event', () => {
    expect(
      stateChangeEvents(
        head,
        { ids: ['a', 'b'], matrix: { leads: true }, none: null },
        { ids: ['a', 'b'], matrix: { leads: true }, none: null },
      ),
    ).toEqual([]);
  });
});

describe('recordAfterEffect (AUD-01)', () => {
  it('writes the event once the effect has happened', async () => {
    const { client, createMany } = makeClient();
    const logger = { error: jest.fn() };

    await recordAfterEffect(client, logger, base);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a failed write instead of throwing, because the effect cannot be taken back', async () => {
    const { client, createMany } = makeClient();
    createMany.mockRejectedValue(new Error('db down'));
    const logger = { error: jest.fn() };

    await expect(
      recordAfterEffect(client, logger, base),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'STATUS_CHANGED (leads.status) was not recorded: db down',
      ),
    );
  });
});
