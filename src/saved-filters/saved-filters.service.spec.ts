import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { SavedFiltersService } from './saved-filters.service';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const FILTER_ID = '33333333-3333-3333-3333-333333333333';

/** A valid payload for the shared whitelist: Assigned User · Is · <uuid>. */
const VALID_CONDITIONS = [
  { field: 'assignedAgent', operator: 'is', values: [OTHER] },
];
const VALID = JSON.stringify(VALID_CONDITIONS);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: FILTER_ID,
    name: 'UAE TEAM',
    conditions: VALID_CONDITIONS,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService(
  user: CurrentUser = { id: ME, role: UserRole.SUPERADMIN },
) {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const deleteMany = jest.fn();

  const prisma = {
    savedFilter: { findMany, findFirst, create, update, deleteMany },
  } as unknown as PrismaService;

  const currentUser: CurrentUserService = {
    resolve: () => Promise.resolve(user),
  };
  const service = new SavedFiltersService(prisma, currentUser);
  return { service, findMany, findFirst, create, update, deleteMany };
}

describe('SavedFiltersService.list', () => {
  it('returns only the caller’s own presets, oldest first', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([row()]);

    const result = await service.list();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: ME },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('UAE TEAM');
    // Conditions come back as the JSON string the query param takes.
    expect(JSON.parse(result[0].conditions) as unknown).toEqual(
      VALID_CONDITIONS,
    );
  });
});

describe('SavedFiltersService.create', () => {
  it('stores a validated preset for the caller', async () => {
    const { service, findFirst, create } = makeService();
    findFirst.mockResolvedValue(null); // no name clash
    create.mockResolvedValue(row());

    const result = await service.create('UAE TEAM', VALID);

    const dataMatcher: unknown = expect.objectContaining({
      user: { connect: { id: ME } },
      name: 'UAE TEAM',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: dataMatcher }),
    );
    expect(result.id).toBe(FILTER_ID);
  });

  it('rejects a malformed conditions payload before writing', async () => {
    const { service, findFirst, create } = makeService();
    findFirst.mockResolvedValue(null);

    await expect(service.create('Bad', 'not-json')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown filter field', async () => {
    const { service, findFirst, create } = makeService();
    findFirst.mockResolvedValue(null);
    const unknownField = JSON.stringify([
      { field: 'nope', operator: 'is', values: ['x'] },
    ]);

    await expect(service.create('Bad', unknownField)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an operator the field’s kind does not allow', async () => {
    const { service, findFirst, create } = makeService();
    findFirst.mockResolvedValue(null);
    const badOperator = JSON.stringify([
      { field: 'assignedAgent', operator: 'contains', values: ['x'] },
    ]);

    await expect(service.create('Bad', badOperator)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name for the same user', async () => {
    const { service, findFirst, create } = makeService();
    findFirst.mockResolvedValue({ id: FILTER_ID }); // name already taken

    await expect(service.create('UAE TEAM', VALID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe('SavedFiltersService.update', () => {
  it('overwrites the caller’s own preset in place (no duplicate row)', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue({ id: FILTER_ID, name: 'UAE TEAM' });
    update.mockResolvedValue(row());

    await service.update(FILTER_ID, { conditions: VALID });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FILTER_ID, userId: ME } }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FILTER_ID } }),
    );
    // The name is preserved when only conditions are sent.
    const calls = update.mock.calls as unknown as Array<
      [{ data: { name?: string } }]
    >;
    expect(calls[0][0].data.name).toBeUndefined();
  });

  it('refuses to update another user’s preset', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue(null); // not found *for this caller*

    await expect(
      service.update(FILTER_ID, { conditions: VALID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a malformed conditions payload on update', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue({ id: FILTER_ID, name: 'UAE TEAM' });

    await expect(
      service.update(FILTER_ID, { conditions: '{"not":"an array"}' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('SavedFiltersService.remove', () => {
  it('deletes only within the caller’s own rows', async () => {
    const { service, deleteMany } = makeService();
    deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove(FILTER_ID)).resolves.toEqual({ id: FILTER_ID });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: FILTER_ID, userId: ME },
    });
  });

  it('refuses to delete another user’s preset', async () => {
    const { service, deleteMany } = makeService();
    deleteMany.mockResolvedValue({ count: 0 }); // scoped delete matched nothing

    await expect(service.remove(FILTER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
