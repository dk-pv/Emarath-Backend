import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSourcesService } from './lead-sources.service';

/** The argument shapes these assertions read back off the mocks. */
interface DataCall {
  data: { name?: string; isActive?: boolean; createdById?: string };
}
interface WhereCall {
  where: { name?: { mode?: string; equals?: string }; source?: string };
}

/** Mocks held as locals so assertions never reference an unbound class method. */
function makeService() {
  const findMany = jest.fn().mockResolvedValue([]);
  const findFirst = jest.fn().mockResolvedValue(null);
  const findUnique = jest.fn();
  // The writes answer with the row as written, so the audit sees what the database would.
  const create = jest
    .fn()
    .mockImplementation((args: DataCall) =>
      Promise.resolve({ id: 'new', ...args.data }),
    );
  // The source as the locked read inside an update's transaction finds it (AUD-03).
  const findUniqueOrThrow = jest
    .fn()
    .mockResolvedValue({ name: 'Website', isActive: true });
  const update = jest
    .fn()
    .mockImplementation((args: DataCall) =>
      Promise.resolve({ name: 'Website', isActive: true, ...args.data }),
    );
  const remove = jest
    .fn()
    .mockResolvedValue({ name: 'Website', isActive: true });
  const groupBy = jest.fn().mockResolvedValue([]);
  const leadCount = jest.fn().mockResolvedValue(0);
  const leadUpdateMany = jest.fn().mockResolvedValue({ count: 4 });
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const $queryRaw = jest.fn().mockResolvedValue([]);

  const prisma = {
    leadSource: {
      findMany,
      findFirst,
      findUnique,
      findUniqueOrThrow,
      create,
      update,
      delete: remove,
    },
    lead: { groupBy, count: leadCount, updateMany: leadUpdateMany },
    auditEvent: { createMany: auditCreateMany },
    $queryRaw,
  } as unknown as PrismaService;
  // A callback gets the client as its transaction.
  const $transaction = jest.fn((run: (tx: PrismaService) => Promise<unknown>) =>
    run(prisma),
  );
  Object.assign(prisma, { $transaction });

  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: 'admin-1', role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;

  return {
    service: new LeadSourcesService(prisma, currentUser),
    findMany,
    findFirst,
    findUnique,
    create,
    update,
    remove,
    groupBy,
    leadCount,
    leadUpdateMany,
    findUniqueOrThrow,
    auditCreateMany,
    $queryRaw,
    $transaction,
  };
}

/** The rows the audit write was asked for, in call order. */
const auditRows = (auditCreateMany: jest.Mock) =>
  (
    auditCreateMany.mock.calls as [{ data: Record<string, unknown>[] }][]
  ).flatMap(([args]) => args.data);

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Website',
  isActive: true,
  createdAt: new Date('2026-04-14T17:18:11Z'),
  createdBy: { name: 'Ahmed Rahman' },
  ...over,
});

describe('LeadSourcesService.list', () => {
  it('returns the catalogue in name order with lead counts from one grouped query', async () => {
    const { service, findMany, groupBy } = makeService();
    findMany.mockResolvedValue([
      row(),
      row({ id: 's2', name: 'Facebook', createdBy: null }),
    ]);
    groupBy.mockResolvedValue([{ source: 'Website', _count: { _all: 42 } }]);

    const [first, second] = await service.list();

    expect(first).toMatchObject({
      name: 'Website',
      leadCount: 42,
      createdByName: 'Ahmed Rahman',
      isActive: true,
    });
    // No creator resolves to null rather than a placeholder name.
    expect(second).toMatchObject({
      name: 'Facebook',
      leadCount: 0,
      createdByName: null,
    });
    expect(groupBy).toHaveBeenCalledTimes(1);
    const [call] = findMany.mock.calls[0] as [{ orderBy: unknown }];
    expect(call.orderBy).toEqual({ name: 'asc' });
  });
});

describe('LeadSourcesService.create', () => {
  it('stamps the authenticated user as the author and defaults to active', async () => {
    const { service, create, findMany } = makeService();
    create.mockResolvedValue({ id: 'new' });
    findMany.mockResolvedValue([row({ id: 'new', name: 'Broadcast' })]);

    await service.create({ name: 'Broadcast' });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data).toMatchObject({
      name: 'Broadcast',
      isActive: true,
      createdById: 'admin-1',
    });
  });

  it('honours an explicitly inactive source', async () => {
    const { service, create, findMany } = makeService();
    create.mockResolvedValue({ id: 'new' });
    findMany.mockResolvedValue([row({ id: 'new', isActive: false })]);

    await service.create({ name: 'Retired', isActive: false });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data.isActive).toBe(false);
  });

  it('trims the stored name', async () => {
    const { service, create, findMany } = makeService();
    create.mockResolvedValue({ id: 'new' });
    findMany.mockResolvedValue([row({ id: 'new', name: 'Referral' })]);

    await service.create({ name: '  Referral  ' });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data.name).toBe('Referral');
  });

  it('refuses a duplicate name, case-insensitively', async () => {
    const { service, findFirst, create } = makeService();
    findFirst.mockResolvedValue({ id: 'existing' });

    await expect(service.create({ name: 'WEBSITE' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(create).not.toHaveBeenCalled();

    const [call] = findFirst.mock.calls[0] as [WhereCall];
    expect(call.where.name?.mode).toBe('insensitive');
  });
});

describe('LeadSourcesService.update', () => {
  it('cascades a rename to the leads carrying the old name, in one transaction', async () => {
    const {
      service,
      findUnique,
      findMany,
      $transaction,
      leadUpdateMany,
      update,
    } = makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    findMany.mockResolvedValue([row({ name: 'Web Site' })]);

    await service.update('s1', { name: 'Web Site' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(leadUpdateMany).toHaveBeenCalledWith({
      where: { source: 'Website' },
      data: { source: 'Web Site' },
    });
    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data.name).toBe('Web Site');
  });

  it('leaves leads alone when only the status changes', async () => {
    const { service, findUnique, findMany, update, leadUpdateMany } =
      makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    findMany.mockResolvedValue([row({ isActive: false })]);

    await service.update('s1', { isActive: false });

    expect(leadUpdateMany).not.toHaveBeenCalled();
    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toEqual({ isActive: false });
  });

  it('never rewrites the author or the creation stamp', async () => {
    const { service, findUnique, findMany, update } = makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    findMany.mockResolvedValue([row({ name: 'Renamed' })]);

    await service.update('s1', { name: 'Renamed', isActive: false });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).not.toHaveProperty('createdById');
    expect(call.data).not.toHaveProperty('createdAt');
  });

  it('refuses a rename onto another source name', async () => {
    const { service, findUnique, findFirst } = makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    findFirst.mockResolvedValue({ id: 's2' });

    await expect(
      service.update('s1', { name: 'Facebook' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an unknown source', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.update('nope', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('LeadSourcesService.remove', () => {
  it('deletes a source no lead carries', async () => {
    const { service, findUnique, leadCount, remove } = makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    leadCount.mockResolvedValue(0);

    await expect(service.remove('s1')).resolves.toEqual({ id: 's1' });
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    );
  });

  it('refuses to delete a source that leads still carry, and touches no lead', async () => {
    const { service, findUnique, leadCount, remove, leadUpdateMany } =
      makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    leadCount.mockResolvedValue(7);

    await expect(service.remove('s1')).rejects.toThrow(/used by 7 leads/);
    // The guarantee that matters: a refused delete must never rewrite or remove leads.
    expect(remove).not.toHaveBeenCalled();
    expect(leadUpdateMany).not.toHaveBeenCalled();
  });

  it('counts only live leads, so a soft-deleted one cannot block a delete', async () => {
    const { service, findUnique, leadCount } = makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });

    await service.remove('s1');

    const [call] = leadCount.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(call.where).toEqual({ source: 'Website', deletedAt: null });
  });

  it('refuses an unknown source', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('LeadSourcesService — configuration audit (AUD-03)', () => {
  it('records a new source as CREATED, by the signed-in user, in the create’s transaction', async () => {
    const { service, findMany, auditCreateMany, $transaction } = makeService();
    findMany.mockResolvedValue([row({ id: 'new', name: 'Broadcast' })]);

    await service.create({ name: 'Broadcast' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(auditRows(auditCreateMany)).toEqual([
      {
        entityType: 'LEAD_SOURCE',
        entityId: 'new',
        leadId: null,
        action: 'CREATED',
        actorType: 'USER',
        actorId: 'admin-1',
        source: 'lead-sources.create',
        before: undefined,
        after: { name: 'Broadcast', isActive: true },
        metadata: undefined,
      },
    ]);
  });

  it('records a rename as RENAMED, with how many leads it relabelled', async () => {
    const { service, findUnique, findMany, auditCreateMany } = makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    findMany.mockResolvedValue([row({ name: 'Web Site' })]);

    await service.update('s1', { name: 'Web Site' });

    expect(auditRows(auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'LEAD_SOURCE',
        entityId: 's1',
        action: 'RENAMED',
        source: 'lead-sources.update',
        before: { name: 'Website' },
        after: { name: 'Web Site' },
        metadata: { leadsRelabelled: 4 },
      }),
    ]);
  });

  it('records a deactivation as UPDATED, and nothing for a save that changes nothing', async () => {
    const changed = makeService();
    changed.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Website',
      isActive: true,
    });
    changed.findMany.mockResolvedValue([row({ isActive: false })]);
    await changed.service.update('s1', { isActive: false });
    expect(auditRows(changed.auditCreateMany)).toEqual([
      expect.objectContaining({
        action: 'UPDATED',
        before: { isActive: true },
        after: { isActive: false },
      }),
    ]);

    const same = makeService();
    same.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Website',
      isActive: true,
    });
    same.findMany.mockResolvedValue([row()]);
    await same.service.update('s1', { name: 'Website', isActive: true });
    expect(same.auditCreateMany).not.toHaveBeenCalled();
  });

  it('locks the source before reading the state it compares against', async () => {
    const { service, findUnique, findMany, findUniqueOrThrow, $queryRaw } =
      makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    findMany.mockResolvedValue([row({ isActive: false })]);

    await service.update('s1', { isActive: false });

    expect($queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('records a delete as DELETED with what the source was; a refused delete records nothing', async () => {
    const deleted = makeService();
    deleted.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Website',
      isActive: true,
    });
    await deleted.service.remove('s1');
    expect(auditRows(deleted.auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'LEAD_SOURCE',
        action: 'DELETED',
        source: 'lead-sources.delete',
        before: { name: 'Website', isActive: true },
      }),
    ]);

    const refused = makeService();
    refused.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Website',
      isActive: true,
    });
    refused.leadCount.mockResolvedValue(7);
    await expect(refused.service.remove('s1')).rejects.toThrow(
      /used by 7 leads/,
    );
    expect(refused.auditCreateMany).not.toHaveBeenCalled();
  });

  it('records nothing when the rename cascade fails — the change and its event roll back together', async () => {
    const { service, findUnique, leadUpdateMany, auditCreateMany } =
      makeService();
    findUnique.mockResolvedValue({ id: 's1', name: 'Website', isActive: true });
    leadUpdateMany.mockRejectedValue(new Error('cascade failed'));

    await expect(service.update('s1', { name: 'Web Site' })).rejects.toThrow(
      'cascade failed',
    );
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});
