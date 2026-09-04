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
function makeService() {
  const findMany = jest.fn();
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest.fn();
  const update = jest.fn();
  const remove = jest.fn();
  const groupBy = jest.fn().mockResolvedValue([]);
  const leadCount = jest.fn().mockResolvedValue(0);
  const leadUpdateMany = jest.fn();
  const $transaction = jest.fn().mockResolvedValue([]);

  const prisma = {
    category: { findMany, findFirst, create, update, delete: remove },
    lead: { groupBy, count: leadCount, updateMany: leadUpdateMany },
    $transaction,
  } as unknown as PrismaService;

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
    $transaction,
  };
}

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
    const { service, findMany, $transaction } = makeService();
    findMany
      .mockResolvedValueOnce([
        { id: 'a', name: 'A', parentId: null, position: 0 },
        { id: 'b', name: 'B', parentId: null, position: 1 },
        { id: 'c', name: 'C', parentId: null, position: 2 },
      ])
      .mockResolvedValue([]);

    await service.move('c', { parentId: null, position: 0 });

    expect($transaction).toHaveBeenCalledTimes(1);
    const [batch] = $transaction.mock.calls[0] as [unknown[]];
    expect(batch).toHaveLength(3);
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
    expect(remove).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('refuses an unknown id', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([]);

    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
