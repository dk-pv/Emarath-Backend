import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

/** The single argument shapes the assertions read back off the mocks. */
interface DataCall {
  data: {
    isActive: boolean;
    name?: string;
    parentId?: string | null;
    position?: number;
    createdById?: string;
  };
}
interface NameWhereCall {
  where: { name: { mode: string } };
}

/** Mocks held as locals so assertions never reference an unbound class method. */
/** A category as the audit's selects read it back. */
const stored = { name: 'Default', parentId: null, isActive: true, position: 0 };

/** What a write's data makes of the stored row: the relation write becomes the parent id. */
function written(data: Record<string, unknown>) {
  const parent = data.parent as
    { connect?: { id: string }; disconnect?: true } | undefined;
  return {
    ...stored,
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
    ...(data.position === undefined ? {} : { position: data.position }),
    ...(parent?.connect ? { parentId: parent.connect.id } : {}),
    ...(parent?.disconnect ? { parentId: null } : {}),
    ...(data.parentId === undefined ? {} : { parentId: data.parentId }),
  };
}

function makeService() {
  const findMany = jest.fn();
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'new', ...written(args.data) }),
    );
  const update = jest
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve(written(args.data)),
    );
  const remove = jest.fn().mockResolvedValue(stored);
  // The category as the locked read inside an update's transaction finds it (AUD-04).
  const findUniqueOrThrow = jest.fn().mockResolvedValue(stored);
  const groupBy = jest.fn().mockResolvedValue([]);
  const leadCount = jest.fn().mockResolvedValue(0);
  const leadUpdateMany = jest.fn().mockResolvedValue({ count: 3 });
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const $queryRaw = jest.fn().mockResolvedValue([]);

  const prisma = {
    category: {
      findMany,
      findFirst,
      findUniqueOrThrow,
      create,
      update,
      delete: remove,
    },
    lead: { groupBy, count: leadCount, updateMany: leadUpdateMany },
    auditEvent: { createMany: auditCreateMany },
    $queryRaw,
  } as unknown as PrismaService;
  // An array runs as a batch; a callback gets the client as its transaction.
  const $transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: PrismaService) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
  Object.assign(prisma, { $transaction });

  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: 'admin-1', role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;

  const service = new CategoriesService(prisma, currentUser);
  return {
    service,
    findMany,
    findFirst,
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

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'c1',
  name: 'Default',
  parentId: null,
  position: 0,
  isActive: true,
  createdAt: new Date('2026-02-04T18:31:45Z'),
  createdBy: { name: 'Admin' },
  ...over,
});

describe('CategoriesService.list', () => {
  it('derives depth, the child flag and the lead count', async () => {
    const { service, findMany, groupBy } = makeService();
    findMany.mockResolvedValue([
      row(),
      row({ id: 'c2', name: 'Logistics', parentId: 'c1', position: 0 }),
    ]);
    groupBy.mockResolvedValue([{ category: 'Default', _count: { _all: 7 } }]);

    const [parent, child] = await service.list();

    expect(parent).toMatchObject({
      name: 'Default',
      level: 1,
      hasChildren: true,
      leadCount: 7,
    });
    expect(child).toMatchObject({
      name: 'Logistics',
      level: 2,
      hasChildren: false,
      leadCount: 0,
    });
  });

  it('counts leads in one grouped query, not one per category', async () => {
    const { service, findMany, groupBy } = makeService();
    findMany.mockResolvedValue([row(), row({ id: 'c2', name: 'Logistics' })]);

    await service.list();

    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});

describe('CategoriesService.create', () => {
  it('appends after the last sibling and stamps the author', async () => {
    const { service, findMany, create } = makeService();
    findMany
      .mockResolvedValueOnce([
        { id: 'c1', name: 'Default', parentId: null, position: 3 },
      ])
      .mockResolvedValue([row({ id: 'new', name: 'Retail', position: 4 })]);
    create.mockResolvedValue({ id: 'new' });

    await service.create({ name: 'Retail' });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data).toMatchObject({
      name: 'Retail',
      parentId: null,
      position: 4,
      createdById: 'admin-1',
      isActive: true,
    });
  });

  it('defaults a new category to active', async () => {
    const { service, findMany, create } = makeService();
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([row({ id: 'new', name: 'Retail' })]);
    create.mockResolvedValue({ id: 'new' });

    await service.create({ name: 'Retail' });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data.isActive).toBe(true);
  });

  it('refuses a duplicate name regardless of case', async () => {
    const { service, findMany, findFirst } = makeService();
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue({ id: 'c1' });

    await expect(service.create({ name: 'logistics' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    const [call] = findFirst.mock.calls[0] as [NameWhereCall];
    expect(call.where.name.mode).toBe('insensitive');
  });

  it('refuses a parent that does not exist', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([]);

    await expect(
      service.create({ name: 'Retail', parentId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CategoriesService.update', () => {
  it('cascades a rename to the leads carrying the old name, in one transaction', async () => {
    const { service, findMany, $transaction, leadUpdateMany } = makeService();
    findMany
      .mockResolvedValueOnce([
        { id: 'c1', name: 'Default', parentId: null, position: 0 },
      ])
      .mockResolvedValue([row({ name: 'Standard' })]);

    await service.update('c1', { name: 'Standard' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(leadUpdateMany).toHaveBeenCalledWith({
      where: { category: 'Default' },
      data: { category: 'Standard' },
    });
  });

  it('does not touch leads when only the status changes', async () => {
    const { service, findMany, update, leadUpdateMany } = makeService();
    findMany
      .mockResolvedValueOnce([
        { id: 'c1', name: 'Default', parentId: null, position: 0 },
      ])
      .mockResolvedValue([row({ isActive: false })]);

    await service.update('c1', { isActive: false });

    expect(leadUpdateMany).not.toHaveBeenCalled();
    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data.isActive).toBe(false);
  });

  it('refuses a rename onto an existing name', async () => {
    const { service, findMany, findFirst } = makeService();
    findMany.mockResolvedValue([
      { id: 'c1', name: 'Default', parentId: null, position: 0 },
    ]);
    findFirst.mockResolvedValue({ id: 'c2' });

    await expect(
      service.update('c1', { name: 'Logistics' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses moving a category beneath its own descendant', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([
      { id: 'c1', name: 'Default', parentId: null, position: 0 },
      { id: 'c2', name: 'Child', parentId: 'c1', position: 0 },
    ]);

    await expect(
      service.update('c1', { parentId: 'c2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses making a category its own parent', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([
      { id: 'c1', name: 'Default', parentId: null, position: 0 },
    ]);

    await expect(
      service.update('c1', { parentId: 'c1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CategoriesService.move', () => {
  it('renumbers the whole sibling list in one transaction', async () => {
    const { service, findMany, update, $transaction } = makeService();
    findMany
      .mockResolvedValueOnce([
        { id: 'a', name: 'A', parentId: null, position: 0 },
        { id: 'b', name: 'B', parentId: null, position: 1 },
        { id: 'c', name: 'C', parentId: null, position: 2 },
      ])
      .mockResolvedValue([]);

    await service.move('c', { parentId: null, position: 0 });

    // One batch: the three renumbering writes, plus the move's event (AUD-04).
    expect($transaction).toHaveBeenCalledTimes(1);
    const [batch] = $transaction.mock.calls[0] as [unknown[]];
    expect(batch).toHaveLength(4);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('refuses a move into its own subtree', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([
      { id: 'a', name: 'A', parentId: null, position: 0 },
      { id: 'b', name: 'B', parentId: 'a', position: 0 },
    ]);

    await expect(
      service.move('a', { parentId: 'b', position: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CategoriesService.remove', () => {
  it('refuses while the category has children', async () => {
    const { service, findMany, remove } = makeService();
    findMany.mockResolvedValue([
      { id: 'c1', name: 'Default', parentId: null, position: 0 },
      { id: 'c2', name: 'Child', parentId: 'c1', position: 0 },
    ]);

    await expect(service.remove('c1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses while leads still carry the name, and says how many', async () => {
    const { service, findMany, leadCount, remove } = makeService();
    findMany.mockResolvedValue([
      { id: 'c1', name: 'Default', parentId: null, position: 0 },
    ]);
    leadCount.mockResolvedValue(12);

    await expect(service.remove('c1')).rejects.toThrow('12 leads');
    expect(remove).not.toHaveBeenCalled();
  });

  it('counts only live leads', async () => {
    const { service, findMany, leadCount } = makeService();
    findMany.mockResolvedValue([
      { id: 'c1', name: 'Default', parentId: null, position: 0 },
    ]);

    await service.remove('c1');

    expect(leadCount).toHaveBeenCalledWith({
      where: { category: 'Default', deletedAt: null },
    });
  });

  it('deletes when nothing depends on it', async () => {
    const { service, findMany, remove } = makeService();
    findMany.mockResolvedValue([
      { id: 'c1', name: 'Default', parentId: null, position: 0 },
    ]);

    await expect(service.remove('c1')).resolves.toEqual({ id: 'c1' });
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
  });

  it('refuses an unknown id', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([]);

    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CategoriesService — configuration audit (AUD-04)', () => {
  const graph = [{ id: 'c1', name: 'Default', parentId: null, position: 0 }];

  it('records a new category as CREATED, by the signed-in user, in the create’s transaction', async () => {
    const { service, findMany, auditCreateMany, $transaction } = makeService();
    findMany
      .mockResolvedValueOnce(graph)
      .mockResolvedValue([row({ id: 'new', name: 'Retail', position: 1 })]);

    await service.create({ name: 'Retail' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(auditRows(auditCreateMany)).toEqual([
      {
        entityType: 'CATEGORY',
        entityId: 'new',
        leadId: null,
        action: 'CREATED',
        actorType: 'USER',
        actorId: 'admin-1',
        source: 'categories.create',
        before: undefined,
        after: { name: 'Retail', parentId: null, isActive: true, position: 1 },
        metadata: undefined,
      },
    ]);
  });

  it('records a rename as RENAMED with how many leads it relabelled', async () => {
    const { service, findMany, auditCreateMany } = makeService();
    findMany
      .mockResolvedValueOnce(graph)
      .mockResolvedValue([row({ name: 'Standard' })]);

    await service.update('c1', { name: 'Standard' });

    expect(auditRows(auditCreateMany)).toMatchObject([
      {
        entityType: 'CATEGORY',
        entityId: 'c1',
        action: 'RENAMED',
        source: 'categories.update',
        before: { name: 'Default' },
        after: { name: 'Standard' },
        metadata: { leadsRelabelled: 3 },
      },
    ]);
  });

  it('records a deactivation and a re-parent as one UPDATED with only what changed', async () => {
    const { service, findMany, auditCreateMany } = makeService();
    findMany
      .mockResolvedValueOnce([
        ...graph,
        { id: 'p1', name: 'Parent', parentId: null, position: 1 },
      ])
      .mockResolvedValue([row()]);

    await service.update('c1', { isActive: false, parentId: 'p1' });

    expect(auditRows(auditCreateMany)).toEqual([
      expect.objectContaining({
        action: 'UPDATED',
        before: { parentId: null, isActive: true },
        after: { parentId: 'p1', isActive: false },
      }),
    ]);
  });

  it('records nothing for a save that changes nothing', async () => {
    const { service, findMany, auditCreateMany } = makeService();
    findMany.mockResolvedValueOnce(graph).mockResolvedValue([row()]);

    await service.update('c1', { name: 'Default', isActive: true });

    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('locks the category before reading the state it compares against', async () => {
    const { service, findMany, findUniqueOrThrow, $queryRaw } = makeService();
    findMany
      .mockResolvedValueOnce(graph)
      .mockResolvedValue([row({ isActive: false })]);

    await service.update('c1', { isActive: false });

    expect($queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('records nothing when the rename cascade fails — the change and its event roll back together', async () => {
    const { service, findMany, leadUpdateMany, auditCreateMany } =
      makeService();
    findMany.mockResolvedValueOnce(graph);
    leadUpdateMany.mockRejectedValue(new Error('cascade failed'));

    await expect(service.update('c1', { name: 'Standard' })).rejects.toThrow(
      'cascade failed',
    );
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('records a drag as one MOVED for the dragged category, by its index among its siblings', async () => {
    const { service, findMany, auditCreateMany } = makeService();
    findMany
      .mockResolvedValueOnce([
        { id: 'a', name: 'A', parentId: null, position: 0 },
        { id: 'b', name: 'B', parentId: null, position: 5 },
        { id: 'c', name: 'C', parentId: null, position: 9 },
      ])
      .mockResolvedValue([]);

    await service.move('c', { parentId: null, position: 0 });

    expect(auditRows(auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'CATEGORY',
        entityId: 'c',
        action: 'MOVED',
        source: 'categories.move',
        before: { position: 2 },
        after: { position: 0 },
      }),
    ]);
  });

  it('records nothing for a drop back where the category already was', async () => {
    const { service, findMany, auditCreateMany } = makeService();
    findMany
      .mockResolvedValueOnce([
        { id: 'a', name: 'A', parentId: null, position: 0 },
        { id: 'b', name: 'B', parentId: null, position: 1 },
      ])
      .mockResolvedValue([]);

    await service.move('b', { parentId: null, position: 1 });

    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('records a delete as DELETED with what the category was; refused deletes record nothing', async () => {
    const deleted = makeService();
    deleted.findMany.mockResolvedValue(graph);
    await deleted.service.remove('c1');
    expect(auditRows(deleted.auditCreateMany)).toMatchObject([
      {
        entityType: 'CATEGORY',
        entityId: 'c1',
        action: 'DELETED',
        source: 'categories.delete',
        before: stored,
      },
    ]);

    const withChildren = makeService();
    withChildren.findMany.mockResolvedValue([
      ...graph,
      { id: 'c2', name: 'Child', parentId: 'c1', position: 0 },
    ]);
    await expect(withChildren.service.remove('c1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    const inUse = makeService();
    inUse.findMany.mockResolvedValue(graph);
    inUse.leadCount.mockResolvedValue(4);
    await expect(inUse.service.remove('c1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(withChildren.auditCreateMany).not.toHaveBeenCalled();
    expect(inUse.auditCreateMany).not.toHaveBeenCalled();
  });
});
