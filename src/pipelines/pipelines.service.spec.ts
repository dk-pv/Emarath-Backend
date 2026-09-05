import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { PipelinesService } from './pipelines.service';

/** The mock argument shapes these assertions read back. */
interface DataCall {
  data: Record<string, unknown>;
}

/** Mocks held as locals so assertions never reference an unbound class method. */
function makeService() {
  const findMany = jest.fn().mockResolvedValue([]);
  const findFirst = jest.fn().mockResolvedValue(null);
  const findUnique = jest.fn();
  const count = jest.fn().mockResolvedValue(0);
  const create = jest.fn();
  const update = jest.fn();
  const updateMany = jest.fn();
  const remove = jest.fn();
  const leadGroupBy = jest.fn().mockResolvedValue([]);
  const leadCount = jest.fn().mockResolvedValue(0);
  const leadUpdateMany = jest.fn();
  const stageUpdateMany = jest.fn();
  const stageDeleteMany = jest.fn();
  const stageFindMany = jest.fn().mockResolvedValue([]);
  const userFindMany = jest.fn().mockResolvedValue([]);
  const userFindFirst = jest.fn().mockResolvedValue({ id: 'u1' });
  const userUpdate = jest.fn();
  const $transaction = jest.fn().mockResolvedValue([]);
  const stageCreateMany = jest.fn();

  const prisma = {
    pipeline: {
      findMany,
      findFirst,
      findUnique,
      count,
      create,
      update,
      updateMany,
      delete: remove,
    },
    lead: {
      groupBy: leadGroupBy,
      count: leadCount,
      updateMany: leadUpdateMany,
    },
    stage: {
      updateMany: stageUpdateMany,
      deleteMany: stageDeleteMany,
      createMany: stageCreateMany,
      findMany: stageFindMany,
    },
    user: {
      findMany: userFindMany,
      findFirst: userFindFirst,
      update: userUpdate,
    },
    $transaction,
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: 'admin-1', role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;

  return {
    service: new PipelinesService(prisma, currentUser),
    findMany,
    findFirst,
    findUnique,
    count,
    create,
    update,
    updateMany,
    remove,
    leadGroupBy,
    leadCount,
    leadUpdateMany,
    stageUpdateMany,
    stageDeleteMany,
    stageCreateMany,
    stageFindMany,
    userFindMany,
    userFindFirst,
    $transaction,
  };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Lead Pipeline',
  shortCode: null,
  isDefault: true,
  createdAt: new Date('2026-02-04T18:31:45Z'),
  createdBy: { name: 'ADMIN' },
  accessMode: 'ALL_USERS',
  templateKey: null,
  permissions: [],
  defaultStageId: null,
  mandatoryValueStageId: null,
  qualifiedStageId: null,
  autoConvertAtWon: false,
  expiryEnabled: false,
  expiryScope: null,
  expiryDays: null,
  expiredStageId: null,
  reassignedStageId: null,
  reassignExpiredToId: null,
  ...over,
});

/** Step 3's minimum payload: the one field the reference marks required. */
const settings = (over: Record<string, unknown> = {}) => ({
  defaultStageId: 's-new',
  ...over,
});

describe('PipelinesService.list', () => {
  it('returns lead counts from one grouped query, default first', async () => {
    const { service, findMany, leadGroupBy } = makeService();
    findMany.mockResolvedValue([
      row(),
      row({ id: 'p2', name: 'QC', isDefault: false, createdBy: null }),
    ]);
    leadGroupBy.mockResolvedValue([
      { pipeline: 'Lead Pipeline', _count: { _all: 28911 } },
    ]);

    const [first, second] = await service.list();

    expect(first).toMatchObject({
      name: 'Lead Pipeline',
      leadCount: 28911,
      createdByName: 'ADMIN',
    });
    expect(second).toMatchObject({
      name: 'QC',
      leadCount: 0,
      createdByName: null,
    });
    expect(leadGroupBy).toHaveBeenCalledTimes(1);
    const [call] = findMany.mock.calls[0] as [{ orderBy: unknown }];
    expect(call.orderBy).toEqual([{ isDefault: 'desc' }, { createdAt: 'asc' }]);
  });
});

describe('PipelinesService.create', () => {
  it('makes the very first pipeline the default', async () => {
    const { service, count, create, findMany } = makeService();
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: 'new' });
    findMany.mockResolvedValue([row({ id: 'new', name: 'Sales' })]);

    await service.create({ name: 'Sales', shortCode: 'SL' });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data).toMatchObject({
      name: 'Sales',
      shortCode: 'SL',
      isDefault: true,
      createdById: 'admin-1',
    });
  });

  it('does not make a later pipeline the default', async () => {
    const { service, count, create, findMany } = makeService();
    count.mockResolvedValue(3);
    create.mockResolvedValue({ id: 'new' });
    findMany.mockResolvedValue([
      row({ id: 'new', name: 'Sales', isDefault: false }),
    ]);

    await service.create({ name: 'Sales', shortCode: 'SL' });

    const [call] = create.mock.calls[0] as [DataCall];
    expect(call.data.isDefault).toBe(false);
  });

  it('refuses a duplicate name regardless of case', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue({ id: 'p1' });

    await expect(
      service.create({ name: 'logistics', shortCode: 'LG' }),
    ).rejects.toBeInstanceOf(ConflictException);
    const [call] = findFirst.mock.calls[0] as [
      { where: { name: { mode: string } } },
    ];
    expect(call.where.name.mode).toBe('insensitive');
  });
});

describe('PipelinesService.update', () => {
  it('cascades a rename to leads, stages and member grants in one transaction', async () => {
    const {
      service,
      findUnique,
      findMany,
      userFindMany,
      $transaction,
      leadUpdateMany,
      stageUpdateMany,
    } = makeService();
    findUnique.mockResolvedValue({
      id: 'p1',
      name: 'LOGISTICS',
      shortCode: null,
      isDefault: false,
    });
    userFindMany.mockResolvedValue([
      { id: 'u1', pipelines: ['LOGISTICS', 'QC'] },
    ]);
    findMany.mockResolvedValue([row({ id: 'p1', name: 'Logistics UAE' })]);

    await service.update('p1', { name: 'Logistics UAE' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(leadUpdateMany).toHaveBeenCalledWith({
      where: { pipeline: 'LOGISTICS' },
      data: { pipeline: 'Logistics UAE' },
    });
    expect(stageUpdateMany).toHaveBeenCalledWith({
      where: { pipeline: 'LOGISTICS' },
      data: { pipeline: 'Logistics UAE' },
    });
    // The member's other grant must survive the rewrite.
    const [batch] = $transaction.mock.calls[0] as [unknown[]];
    expect(batch).toHaveLength(4);
  });

  it('leaves leads alone when only the short code changes', async () => {
    const { service, findUnique, findMany, update, leadUpdateMany } =
      makeService();
    findUnique.mockResolvedValue({
      id: 'p1',
      name: 'QC',
      shortCode: null,
      isDefault: false,
    });
    findMany.mockResolvedValue([
      row({ id: 'p1', name: 'QC', shortCode: 'QC1' }),
    ]);

    await service.update('p1', { shortCode: 'QC1' });

    expect(leadUpdateMany).not.toHaveBeenCalled();
    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toEqual({ shortCode: 'QC1' });
  });

  it('refuses an unknown pipeline', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.update('nope', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PipelinesService.update — step 3 settings', () => {
  /** Every settings test edits the same pipeline, whose stages are s-new/s-won. */
  const ready = () => {
    const kit = makeService();
    kit.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Sales',
      shortCode: 'SL',
      isDefault: false,
      accessMode: 'ALL_USERS',
    });
    kit.stageFindMany.mockResolvedValue([
      { id: 's-new', pipeline: 'Sales' },
      { id: 's-won', pipeline: 'Sales' },
      { id: 's-qual', pipeline: 'Sales' },
    ]);
    kit.findMany.mockResolvedValue([row({ id: 'p1', name: 'Sales' })]);
    return kit;
  };

  it('writes the whole block, so a cleared field comes back cleared', async () => {
    const { service, update } = ready();

    await service.update('p1', {
      settings: settings({
        qualifiedStageId: 's-qual',
        autoConvertAtWon: true,
      }),
    });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toEqual({
      defaultStageId: 's-new',
      mandatoryValueStageId: null,
      qualifiedStageId: 's-qual',
      autoConvertAtWon: true,
      expiryEnabled: false,
      expiryScope: null,
      expiryDays: null,
      expiredStageId: null,
      reassignedStageId: null,
      reassignExpiredToId: null,
    });
  });

  it('requires the four asterisked expiry fields once expiry is on', async () => {
    const { service } = ready();

    await expect(
      service.update('p1', { settings: settings({ expiryEnabled: true }) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts expiry without a reassignment target — the reference marks it optional', async () => {
    const { service, update } = ready();

    await service.update('p1', {
      settings: settings({
        expiryEnabled: true,
        expiryScope: 'INDIVIDUAL_LEADS',
        expiryDays: 30,
        expiredStageId: 's-won',
        reassignedStageId: 's-new',
      }),
    });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toMatchObject({
      expiryEnabled: true,
      expiryDays: 30,
      reassignExpiredToId: null,
    });
  });

  it('keeps the expiry configuration when the toggle goes off', async () => {
    const { service, update } = ready();

    await service.update('p1', {
      settings: settings({
        expiryEnabled: false,
        expiryScope: 'ALL_LEADS',
        expiryDays: 30,
        expiredStageId: 's-won',
        reassignedStageId: 's-new',
      }),
    });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toMatchObject({
      expiryEnabled: false,
      expiryScope: 'ALL_LEADS',
      expiryDays: 30,
      expiredStageId: 's-won',
      reassignedStageId: 's-new',
    });
  });

  it('refuses a stage that belongs to another pipeline', async () => {
    const { service, stageFindMany } = ready();
    stageFindMany.mockResolvedValue([{ id: 's-new', pipeline: 'QC' }]);

    await expect(
      service.update('p1', { settings: settings() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a stage id that does not exist at all', async () => {
    const { service, stageFindMany } = ready();
    stageFindMany.mockResolvedValue([]);

    await expect(
      service.update('p1', { settings: settings() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a reassignment target who is not a current team member', async () => {
    const { service, userFindFirst } = ready();
    userFindFirst.mockResolvedValue(null);

    await expect(
      service.update('p1', {
        settings: settings({ reassignExpiredToId: 'gone' }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves every setting untouched when step 1 saves', async () => {
    const { service, update, stageFindMany } = ready();

    await service.update('p1', { shortCode: 'SL2' });

    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toEqual({ shortCode: 'SL2' });
    expect(stageFindMany).not.toHaveBeenCalled();
  });

  it('carries the settings through a rename, in the same write', async () => {
    const { service, update } = ready();

    await service.update('p1', {
      name: 'Sales UAE',
      settings: settings({ autoConvertAtWon: true }),
    });

    // The rename path returns early, so this is the assertion that catches step 3 being
    // dropped whenever the name changes in the same submit.
    const [call] = update.mock.calls[0] as [DataCall];
    expect(call.data).toMatchObject({
      name: 'Sales UAE',
      defaultStageId: 's-new',
      autoConvertAtWon: true,
    });
  });

  it('returns the stored settings on the node', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([
      row({ expiryEnabled: true, expiryDays: 45, expiryScope: 'ALL_LEADS' }),
    ]);

    const [node] = await service.list();

    expect(node.settings).toMatchObject({
      expiryEnabled: true,
      expiryDays: 45,
      expiryScope: 'ALL_LEADS',
    });
  });
});

describe('PipelinesService.setDefault', () => {
  it('clears the previous default and sets the new one together', async () => {
    const { service, findUnique, findMany, $transaction, updateMany } =
      makeService();
    findUnique.mockResolvedValue({
      id: 'p2',
      name: 'QC',
      shortCode: null,
      isDefault: false,
    });
    findMany.mockResolvedValue([]);

    await service.setDefault('p2');

    expect($transaction).toHaveBeenCalledTimes(1);
    const [call] = updateMany.mock.calls[0] as [
      { where: { isDefault: boolean; id: { not: string } } },
    ];
    expect(call.where).toEqual({ isDefault: true, id: { not: 'p2' } });
  });
});

describe('PipelinesService.remove', () => {
  it('refuses to delete the default pipeline', async () => {
    const { service, findUnique, remove } = makeService();
    findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Lead Pipeline',
      shortCode: null,
      isDefault: true,
    });

    await expect(service.remove('p1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses while leads still sit on it, and says how many', async () => {
    const { service, findUnique, leadCount, remove } = makeService();
    findUnique.mockResolvedValue({
      id: 'p2',
      name: 'LOGISTICS',
      shortCode: null,
      isDefault: false,
    });
    leadCount.mockResolvedValue(3072);

    await expect(service.remove('p2')).rejects.toThrow('3072 leads');
    expect(remove).not.toHaveBeenCalled();
  });

  it('counts only live leads', async () => {
    const { service, findUnique, leadCount } = makeService();
    findUnique.mockResolvedValue({
      id: 'p2',
      name: 'QC',
      shortCode: null,
      isDefault: false,
    });

    await service.remove('p2');

    expect(leadCount).toHaveBeenCalledWith({
      where: { pipeline: 'QC', deletedAt: null },
    });
  });

  it('takes the pipeline stages with it, in one transaction', async () => {
    const { service, findUnique, $transaction, stageDeleteMany } =
      makeService();
    findUnique.mockResolvedValue({
      id: 'p2',
      name: 'QC',
      shortCode: null,
      isDefault: false,
    });

    await expect(service.remove('p2')).resolves.toEqual({ id: 'p2' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(stageDeleteMany).toHaveBeenCalledWith({ where: { pipeline: 'QC' } });
  });
});

describe('PipelinesService permissions', () => {
  it('stores the grants when access is restricted to specific targets', async () => {
    const { service, count, create, findMany } = makeService();
    count.mockResolvedValue(1);
    create.mockResolvedValue({ id: 'new', name: 'Sales' });
    findMany.mockResolvedValue([row({ id: 'new', name: 'Sales' })]);

    await service.create({
      name: 'Sales',
      shortCode: 'SL',
      accessMode: 'SPECIFIC',
      permissions: [
        {
          permissionType: 'ROLE',
          roleId: '11111111-1111-4111-8111-111111111111',
        },
        {
          permissionType: 'USER',
          userId: '22222222-2222-4222-8222-222222222222',
        },
      ],
    });

    const [call] = create.mock.calls[0] as [
      { data: { accessMode: string; permissions?: { create: unknown[] } } },
    ];
    expect(call.data.accessMode).toBe('SPECIFIC');
    expect(call.data.permissions?.create).toHaveLength(2);
  });

  it('keeps no grants when the pipeline is open to all users', async () => {
    const { service, count, create, findMany } = makeService();
    count.mockResolvedValue(1);
    create.mockResolvedValue({ id: 'new', name: 'Sales' });
    findMany.mockResolvedValue([row({ id: 'new', name: 'Sales' })]);

    await service.create({
      name: 'Sales',
      shortCode: 'SL',
      accessMode: 'ALL_USERS',
      permissions: [
        {
          permissionType: 'ROLE',
          roleId: '11111111-1111-4111-8111-111111111111',
        },
      ],
    });

    const [call] = create.mock.calls[0] as [
      { data: { permissions?: unknown } },
    ];
    expect(call.data.permissions).toBeUndefined();
  });

  it('refuses a role row with no role chosen', async () => {
    const { service, count } = makeService();
    count.mockResolvedValue(1);

    await expect(
      service.create({
        name: 'Sales',
        shortCode: 'SL',
        accessMode: 'SPECIFIC',
        permissions: [{ permissionType: 'ROLE' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a user row with no user chosen', async () => {
    const { service, count } = makeService();
    count.mockResolvedValue(1);

    await expect(
      service.create({
        name: 'Sales',
        shortCode: 'SL',
        accessMode: 'SPECIFIC',
        permissions: [{ permissionType: 'USER' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replaces the whole grant list on update', async () => {
    const { service, findUnique, findMany, update } = makeService();
    findUnique.mockResolvedValue({
      id: 'p1',
      name: 'QC',
      shortCode: null,
      isDefault: false,
      accessMode: 'SPECIFIC',
    });
    findMany.mockResolvedValue([row({ id: 'p1', name: 'QC' })]);

    await service.update('p1', {
      accessMode: 'SPECIFIC',
      permissions: [
        {
          permissionType: 'USER',
          userId: '22222222-2222-4222-8222-222222222222',
        },
      ],
    });

    const [call] = update.mock.calls[0] as [
      { data: { permissions: { deleteMany: unknown; create?: unknown[] } } },
    ];
    expect(call.data.permissions.deleteMany).toEqual({});
    expect(call.data.permissions.create).toHaveLength(1);
  });
});

describe('PipelinesService template cloning', () => {
  it('records the chosen template on the pipeline', async () => {
    const { service, count, create, findMany } = makeService();
    count.mockResolvedValue(1);
    create.mockResolvedValue({ id: 'new', name: 'Courses' });
    findMany.mockResolvedValue([row({ id: 'new', name: 'Courses' })]);

    await service.create({
      name: 'Courses',
      shortCode: 'CRS',
      templateKey: 'Education',
    });

    const [call] = create.mock.calls[0] as [{ data: { templateKey: string } }];
    expect(call.data.templateKey).toBe('Education');
  });

  // The reference proves the eight template names and nothing about their contents, so
  // every set is empty on purpose (ADR-0060) — cloning must add no invented stages.
  it('creates no stages while the template sets are empty', async () => {
    const { service, count, create, findMany, stageCreateMany } = makeService();
    count.mockResolvedValue(1);
    create.mockResolvedValue({ id: 'new', name: 'Courses' });
    findMany.mockResolvedValue([row({ id: 'new', name: 'Courses' })]);

    await service.create({
      name: 'Courses',
      shortCode: 'CRS',
      templateKey: 'Education',
    });

    expect(stageCreateMany).not.toHaveBeenCalled();
  });
});
