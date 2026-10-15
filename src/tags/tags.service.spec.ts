import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  TAG_CREATE_NOT_PERMITTED,
  TagAccessService,
} from '../tag-access/tag-access.service';
import { TagsService } from './tags.service';

interface DataCall {
  data: { name?: string; isActive?: boolean; deletedAt?: Date };
  where?: { id?: string };
}
interface FindCall {
  where: {
    name?: { mode?: string };
    deletedAt?: unknown;
    isActive?: boolean;
  };
  select?: Record<string, unknown>;
}

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const findMany = jest.fn().mockResolvedValue([]);
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest.fn();
  const update = jest.fn();
  const remove = jest.fn();
  const leadTagDeleteMany = jest.fn();

  // A non-admin's create runs in a transaction so the tag and the creator's grant commit
  // together: the writes exist on `tx` only, and a write that escaped it would throw.
  const txCreate = jest.fn();
  const tx = { tag: { create: txCreate } };
  const prisma = {
    tag: { findMany, findFirst, create, update, delete: remove },
    leadTag: { deleteMany: leadTagDeleteMany },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;
  const assertMayCreate = jest.fn().mockResolvedValue(undefined);
  const grantToCreator = jest.fn().mockResolvedValue(undefined);
  const access = {
    assertMayCreate,
    grantToCreator,
  } as unknown as TagAccessService;

  return {
    txCreate,
    assertMayCreate,
    grantToCreator,
    service: new TagsService(prisma, currentUser, access),
    findMany,
    findFirst,
    create,
    update,
    remove,
    leadTagDeleteMany,
  };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'BDE RISK',
  isActive: true,
  _count: { leads: 537 },
  ...over,
});

describe('TagsService.list', () => {
  it('returns the catalogue with lead counts, name order, soft-deleted excluded', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([
      row(),
      row({ id: 't2', name: 'CALL 1', _count: { leads: 0 } }),
    ]);

    const [first, second] = await service.list();

    expect(first).toEqual({
      id: 't1',
      name: 'BDE RISK',
      isActive: true,
      leadCount: 537,
    });
    expect(second.leadCount).toBe(0);

    const [call] = findMany.mock.calls[0] as [FindCall & { orderBy: unknown }];
    expect(call.where.deletedAt).toBeNull();
    expect(call.orderBy).toEqual({ name: 'asc' });
    // One aggregate in the same query, not a count per row.
    expect(call.select).toHaveProperty('_count');
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('counts only live leads, so a soft-deleted lead never inflates the number', async () => {
    const { service, findMany } = makeService();
    await service.list();

    const [call] = findMany.mock.calls[0] as [{ select: { _count: unknown } }];
    expect(JSON.stringify(call.select._count)).toContain('deletedAt');
  });
});

describe('TagsService.create', () => {
  it('trims the name and defaults to active', async () => {
    const { service, create } = makeService();
    create.mockResolvedValue(row({ name: 'DISPATCHED' }));

    await service.create({ name: '  DISPATCHED  ' });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data).toEqual({ name: 'DISPATCHED', isActive: true });
  });

  it('honours an explicitly inactive tag', async () => {
    const { service, create } = makeService();
    create.mockResolvedValue(row({ isActive: false }));

    await service.create({ name: 'RETIRED', isActive: false });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data.isActive).toBe(false);
  });

  it('refuses a duplicate name case-insensitively, ignoring soft-deleted rows', async () => {
    const { service, findFirst, create } = makeService();
    findFirst.mockResolvedValue({ id: 'existing' });

    await expect(service.create({ name: 'bde risk' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(create).not.toHaveBeenCalled();

    const [call] = findFirst.mock.calls[0] as [FindCall];
    expect(call.where.name?.mode).toBe('insensitive');
    expect(call.where.deletedAt).toBeNull();
  });
});

describe('TagsService.create — Tag Permissions (ADR-0091)', () => {
  it('lets an administrator create without consulting the policy', async () => {
    const { service, create, assertMayCreate, txCreate } = makeService();
    create.mockResolvedValue(row({ name: 'NEW' }));

    await service.create({ name: 'NEW' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(assertMayCreate).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('refuses a user the Admin has not allowed to create tags, writing nothing', async () => {
    const { service, create, txCreate, assertMayCreate } = makeService(
      UserRole.SALES_AGENT,
    );
    assertMayCreate.mockRejectedValue(
      new ForbiddenException(TAG_CREATE_NOT_PERMITTED),
    );

    await expect(service.create({ name: 'SNEAKY' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('creates an active tag for an allowed user and grants it to them in the same transaction', async () => {
    const { service, txCreate, create, grantToCreator, assertMayCreate } =
      makeService(UserRole.SALES_AGENT);
    txCreate.mockResolvedValue(row({ id: 'new-tag', name: 'MINE' }));

    const created = await service.create({ name: ' MINE ', isActive: false });

    expect(assertMayCreate).toHaveBeenCalledTimes(1);
    const [call] = txCreate.mock.calls[0] as [DataCall];
    // The Active switch is catalogue management, not theirs: always active, trimmed name.
    expect(call.data).toEqual({ name: 'MINE', isActive: true });
    expect(create).not.toHaveBeenCalled();
    expect(grantToCreator).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'u1', role: UserRole.SALES_AGENT },
      'new-tag',
    );
    expect(created.name).toBe('MINE');
  });

  it('still refuses a duplicate name for an allowed user', async () => {
    const { service, findFirst, txCreate } = makeService(UserRole.SALES_AGENT);
    findFirst.mockResolvedValue({ id: 'existing' });

    await expect(service.create({ name: 'bde risk' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(txCreate).not.toHaveBeenCalled();
  });
});

describe('TagsService.update', () => {
  it('renames the row in place, so every lead link survives', async () => {
    const { service, findFirst, update, remove, create } = makeService();
    findFirst.mockResolvedValueOnce({ id: 't1', name: 'BDE RISK' });
    update.mockResolvedValue(row({ name: 'BDE REVIEW' }));

    await service.update('t1', { name: 'BDE REVIEW' });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.where?.id).toBe('t1');
    expect(call.data.name).toBe('BDE REVIEW');
    // The guarantee of an id-keyed catalogue: no delete-and-recreate, no cascade.
    expect(remove).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('changes status without touching the name', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValueOnce({ id: 't1', name: 'BDE RISK' });
    update.mockResolvedValue(row({ isActive: false }));

    await service.update('t1', { isActive: false });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toEqual({ isActive: false });
  });

  it('refuses a rename onto another live tag', async () => {
    const { service, findFirst } = makeService();
    findFirst
      .mockResolvedValueOnce({ id: 't1', name: 'BDE RISK' })
      .mockResolvedValueOnce({ id: 't2' });

    await expect(
      service.update('t1', { name: 'CALL 1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an unknown or already-deleted tag', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue(null);

    await expect(service.update('nope', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TagsService.remove', () => {
  it('soft deletes, leaving every lead link intact', async () => {
    const { service, findFirst, update, remove, leadTagDeleteMany } =
      makeService();
    findFirst.mockResolvedValue({ id: 't1', name: 'BDE RISK' });
    update.mockResolvedValue({ id: 't1' });

    await expect(service.remove('t1')).resolves.toEqual({ id: 't1' });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    // The point of the soft delete: LeadTag cascades, so a row delete would strip the
    // tag off every lead carrying it.
    expect(remove).not.toHaveBeenCalled();
    expect(leadTagDeleteMany).not.toHaveBeenCalled();
  });

  it('refuses an unknown tag', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue(null);

    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
