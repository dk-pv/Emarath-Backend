import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadsBulkService } from './leads-bulk.service';
import { bulkResponse } from './dto/bulk-actions.dto';

/** A row shaped like the audit select (ADR-0083) — only what the log compares. */
function auditRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'New',
    lostReason: null,
    pipeline: 'Lead Pipeline',
    deletedAt: null,
    assignments: [],
    tags: [],
    customFieldValues: [],
    complaints: [],
    ...overrides,
  };
}

type FindManyArgs = { where: { id: { in: string[] }; OR?: unknown } };

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const userFindFirst = jest.fn();
  const leadFindMany = jest.fn();
  const assignmentDeleteMany = jest.fn();
  const assignmentCreateMany = jest.fn();

  /*
    Inside the transaction, lead reads are either the retention check (it filters on
    linked calls) or the audit snapshot. `retained` and `states` stand in for the
    database: which leads have calls, and what each lead looks like before/after.
    A deleted lead is gone for every later read, as it would be in the database.
  */
  const retained: {
    id: string;
    _count: { calls: number };
    logisticsOrder?: { id: string } | null;
  }[] = [];
  const states: ReturnType<typeof auditRow>[][] = [];
  const deleted = new Set<string>();
  const leadDeleteMany = jest.fn(
    (args: { where: { id: { in: string[] } } }) => {
      args.where.id.in.forEach((id) => deleted.add(id));
      return Promise.resolve({ count: args.where.id.in.length });
    },
  );
  const auditFindMany = jest.fn((args: FindManyArgs) => {
    const ids = args.where.id.in.filter((id) => !deleted.has(id));
    return Promise.resolve(
      args.where.OR
        ? retained.filter((row) => ids.includes(row.id))
        : (states.shift() ?? ids.map((id) => auditRow(id))).filter(
            (row) => !deleted.has(row.id),
          ),
    );
  });
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const tx = {
    $queryRaw,
    lead: { findMany: auditFindMany, deleteMany: leadDeleteMany },
    leadAssignment: {
      deleteMany: assignmentDeleteMany,
      createMany: assignmentCreateMany,
    },
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
  const $transaction = jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
    run(tx),
  );

  // Writes exist only on `tx`: a write that escaped the audit transaction would throw.
  const prisma = {
    user: { findFirst: userFindFirst },
    lead: { findMany: leadFindMany },
    $transaction,
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;

  const service = new LeadsBulkService(prisma, currentUser);
  return {
    service,
    userFindFirst,
    leadFindMany,
    leadDeleteMany,
    assignmentCreateMany,
    $transaction,
    $queryRaw,
    auditCreateMany,
    retained,
    states,
  };
}

/** The audit rows written by the one createMany call a change makes. */
function recorded(auditCreateMany: jest.Mock): Record<string, unknown>[] {
  return (
    auditCreateMany.mock.calls[0] as [{ data: Record<string, unknown>[] }]
  )[0].data;
}

describe('bulkResponse', () => {
  it('reports each id and summarises success vs failure', () => {
    const res = bulkResponse(['a', 'b', 'c'], new Set(['a', 'c']));
    expect(res.summary).toEqual({ total: 3, success: 2, failed: 1 });
    expect(res.results).toEqual([
      { id: 'a', status: 'success' },
      { id: 'b', status: 'failed', reason: 'Lead not found or not permitted.' },
      { id: 'c', status: 'success' },
    ]);
  });
});

describe('LeadsBulkService.reassign', () => {
  it('rejects an invalid target agent before touching leads', async () => {
    const { service, userFindFirst, leadFindMany } = makeService();
    userFindFirst.mockResolvedValue(null);

    await expect(
      service.reassign({ ids: ['a'], agentId: 'agent' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(leadFindMany).not.toHaveBeenCalled();
  });

  it('reassigns only in-scope leads and reports the rest as failed', async () => {
    const {
      service,
      userFindFirst,
      leadFindMany,
      assignmentCreateMany,
      $transaction,
    } = makeService();
    userFindFirst.mockResolvedValue({ id: 'agent' });
    leadFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    const res = await service.reassign({
      ids: ['a', 'b', 'c'],
      agentId: 'agent',
    });

    expect(res.summary).toEqual({ total: 3, success: 2, failed: 1 });
    expect($transaction).toHaveBeenCalledTimes(1);
    const created = (assignmentCreateMany.mock.calls as unknown[][])[0][0] as {
      data: { leadId: string; userId: string }[];
    };
    expect(created.data).toEqual([
      { leadId: 'a', userId: 'agent' },
      { leadId: 'b', userId: 'agent' },
    ]);
  });

  it('does nothing when no id is in scope', async () => {
    const { service, userFindFirst, leadFindMany, $transaction } =
      makeService();
    userFindFirst.mockResolvedValue({ id: 'agent' });
    leadFindMany.mockResolvedValue([]);

    const res = await service.reassign({ ids: ['x'], agentId: 'agent' });
    expect(res.summary).toEqual({ total: 1, success: 0, failed: 1 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('records each lead’s previous and new assignees, under a row lock (ADR-0083)', async () => {
    const {
      service,
      userFindFirst,
      leadFindMany,
      auditCreateMany,
      $queryRaw,
      states,
    } = makeService();
    userFindFirst.mockResolvedValue({ id: 'agent' });
    leadFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    states.push(
      [
        auditRow('a', { assignments: [{ userId: 'old-1' }] }),
        auditRow('b', { assignments: [] }),
      ],
      [
        auditRow('a', { assignments: [{ userId: 'agent' }] }),
        auditRow('b', { assignments: [{ userId: 'agent' }] }),
      ],
    );

    await service.reassign({ ids: ['a', 'b'], agentId: 'agent' });

    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(recorded(auditCreateMany)).toMatchObject([
      {
        entityId: 'a',
        action: 'REASSIGNED',
        actorId: 'u1',
        source: 'leads.bulk-reassign',
        before: { assigneeIds: ['old-1'] },
        after: { assigneeIds: ['agent'] },
      },
      {
        entityId: 'b',
        action: 'ASSIGNED',
        before: { assigneeIds: [] },
        after: { assigneeIds: ['agent'] },
      },
    ]);
  });

  it('records nothing for a lead already owned by the target alone', async () => {
    const { service, userFindFirst, leadFindMany, auditCreateMany, states } =
      makeService();
    userFindFirst.mockResolvedValue({ id: 'agent' });
    leadFindMany.mockResolvedValue([{ id: 'a' }]);
    const owned = auditRow('a', { assignments: [{ userId: 'agent' }] });
    states.push([owned], [owned]);

    await service.reassign({ ids: ['a'], agentId: 'agent' });

    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('labels a single-lead reassign with the caller’s source', async () => {
    const { service, userFindFirst, leadFindMany, auditCreateMany, states } =
      makeService();
    userFindFirst.mockResolvedValue({ id: 'agent' });
    leadFindMany.mockResolvedValue([{ id: 'a' }]);
    states.push(
      [auditRow('a', { assignments: [{ userId: 'old-1' }] })],
      [auditRow('a', { assignments: [{ userId: 'agent' }] })],
    );

    await service.reassign({ ids: ['a'], agentId: 'agent' }, 'leads.reassign');

    expect(recorded(auditCreateMany)[0].source).toBe('leads.reassign');
  });
});

describe('LeadsBulkService.delete', () => {
  it('hard-deletes only in-scope leads and reports the rest as failed', async () => {
    const { service, leadFindMany, leadDeleteMany } = makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);

    const res = await service.delete({ ids: ['a', 'b'] });

    expect(res.summary).toEqual({ total: 2, success: 1, failed: 1 });
    const where = (leadDeleteMany.mock.calls as unknown[][])[0][0] as {
      where: { id: { in: string[] } };
    };
    expect(where.where.id.in).toEqual(['a']);
  });

  it('never issues a delete when nothing is in scope', async () => {
    const { service, leadFindMany, leadDeleteMany } = makeService();
    leadFindMany.mockResolvedValue([]);

    const res = await service.delete({ ids: ['x', 'y'] });
    expect(res.summary.success).toBe(0);
    expect(leadDeleteMany).not.toHaveBeenCalled();
  });

  it('de-duplicates repeated ids', async () => {
    const { service, leadFindMany } = makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);

    const res = await service.delete({ ids: ['a', 'a'] });
    expect(res.results).toHaveLength(1);
  });

  it('keeps each deleted lead’s last state in a DELETED event, in the delete’s transaction (ADR-0083)', async () => {
    const {
      service,
      leadFindMany,
      leadDeleteMany,
      auditCreateMany,
      $queryRaw,
      states,
    } = makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);
    states.push([auditRow('a', { status: 'WON' })]);

    await service.delete({ ids: ['a'] });

    expect(recorded(auditCreateMany)).toMatchObject([
      {
        entityId: 'a',
        action: 'DELETED',
        actorId: 'u1',
        source: 'leads.bulk-delete',
        before: { status: 'WON', pipeline: 'Lead Pipeline' },
      },
    ]);
    expect(leadDeleteMany).toHaveBeenCalledTimes(1);
    // Locked first, and the last state is written before the row goes.
    expect($queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      leadDeleteMany.mock.invocationCallOrder[0],
    );
    expect(auditCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
      leadDeleteMany.mock.invocationCallOrder[0],
    );
  });

  it('refuses to delete a lead with linked calls: 409, nothing deleted, attempt recorded', async () => {
    const {
      service,
      leadFindMany,
      leadDeleteMany,
      auditCreateMany,
      retained,
      $transaction,
      $queryRaw,
    } = makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);
    retained.push({ id: 'a', _count: { calls: 3 } });

    await expect(
      service.delete({ ids: ['a'] }, 'leads.delete'),
    ).rejects.toThrow(
      new ConflictException(
        'This lead has linked records, so it can’t be permanently deleted. Archive it instead.',
      ),
    );
    expect(leadDeleteMany).not.toHaveBeenCalled();
    // The check ran under the lock, and the transaction holding the DELETE_BLOCKED event
    // resolved — it commits; the 409 is raised only after it.
    expect($queryRaw).toHaveBeenCalledTimes(1);
    await expect(
      ($transaction.mock.results[0] as { value: Promise<number> }).value,
    ).resolves.toBe(1);
    expect(recorded(auditCreateMany)).toMatchObject([
      {
        entityId: 'a',
        action: 'DELETE_BLOCKED',
        source: 'leads.delete',
        metadata: { reason: 'LINKED_RECORDS', linked: { calls: 3 } },
      },
    ]);
  });

  /*
    ADR-0085 B15: a converted lead is held in place by its order, with no calls needed. The
    database would refuse the delete anyway — `logistics_orders.lead_id` is RESTRICT — but the
    rule is read here first so the caller gets a 409 and an audit trail, not a failed statement.
  */
  it('refuses to delete a lead that has a Logistics order', async () => {
    const { service, leadFindMany, leadDeleteMany, auditCreateMany, retained } =
      makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);
    retained.push({
      id: 'a',
      _count: { calls: 0 },
      logisticsOrder: { id: 'order-1' },
    });

    await expect(
      service.delete({ ids: ['a'] }, 'leads.delete'),
    ).rejects.toThrow(ConflictException);
    expect(leadDeleteMany).not.toHaveBeenCalled();
    expect(recorded(auditCreateMany)).toMatchObject([
      {
        entityId: 'a',
        action: 'DELETE_BLOCKED',
        metadata: {
          reason: 'LINKED_RECORDS',
          linked: { calls: 0, logisticsOrder: 1 },
        },
      },
    ]);
  });

  it('deletes nothing in a selection that includes one retained lead', async () => {
    const { service, leadFindMany, leadDeleteMany, auditCreateMany, retained } =
      makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    retained.push({ id: 'b', _count: { calls: 1 } });

    await expect(service.delete({ ids: ['a', 'b'] })).rejects.toThrow(
      '1 selected lead has linked records, so nothing was deleted.',
    );
    expect(leadDeleteMany).not.toHaveBeenCalled();
    expect(recorded(auditCreateMany)).toHaveLength(1);
  });

  it('turns a delete the database refused into a 409, not a 500', async () => {
    const { service, leadFindMany, leadDeleteMany } = makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);
    leadDeleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(service.delete({ ids: ['a'] })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
