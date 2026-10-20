import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user';
import { UserRole } from '../generated/prisma/client';
import { RolesService } from './roles.service';

const ADMIN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ROOT = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const CHILD = 'cccccccc-1111-4111-8111-cccccccccccc';
const GRANDCHILD = 'dddddddd-1111-4111-8111-dddddddddddd';

/** id/parent/position rows, the shape the hierarchy rules read. */
function graph() {
  return [
    { id: ROOT, name: 'Account Holder', parentId: null, position: 0 },
    { id: CHILD, name: 'User', parentId: ROOT, position: 0 },
    { id: GRANDCHILD, name: 'Agent', parentId: CHILD, position: 0 },
  ];
}

/** Full rows, the shape `list()` maps into RoleNodes. */
function fullRows() {
  return graph().map((r, index) => ({
    ...r,
    baseRole: UserRole.SALES_AGENT,
    createdAt: new Date('2026-02-04T18:31:45.000Z'),
    createdBy: index === 0 ? null : { name: 'Emarath Admin' },
    _count: { users: index },
  }));
}

function makeService() {
  const roleFindMany = jest.fn();
  const roleFindFirst = jest.fn();
  const roleCreate = jest.fn();
  const roleUpdate = jest.fn();
  const userCount = jest.fn();
  // History (AUD-01): the before-read, the conditional soft delete and the event table.
  const roleFindUniqueOrThrow = jest.fn().mockResolvedValue({
    name: 'User',
    baseRole: UserRole.SALES_AGENT,
    parentId: ROOT,
  });
  const roleUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const auditCreateMany = jest.fn();
  // Callback transactions run against the same double; array ones resolve their operations.
  const transaction = jest.fn((arg: ((tx: unknown) => unknown) | unknown[]) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );

  const prisma = {
    role: {
      findMany: roleFindMany,
      findFirst: roleFindFirst,
      findUniqueOrThrow: roleFindUniqueOrThrow,
      create: roleCreate,
      update: roleUpdate,
      updateMany: roleUpdateMany,
    },
    user: { count: userCount },
    auditEvent: { createMany: auditCreateMany },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: transaction,
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: ADMIN, role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;

  return {
    service: new RolesService(prisma, currentUser),
    roleFindMany,
    roleFindFirst,
    roleCreate,
    roleUpdate,
    roleUpdateMany,
    roleFindUniqueOrThrow,
    userCount,
    transaction,
    auditCreateMany,
  };
}

describe('RolesService.list', () => {
  it('derives level, hasChildren and the real assigned count', async () => {
    const { service, roleFindMany } = makeService();
    roleFindMany.mockResolvedValue(fullRows());

    const nodes = await service.list();

    expect(nodes.map((n) => [n.name, n.level])).toEqual([
      ['Account Holder', 1],
      ['User', 2],
      ['Agent', 3],
    ]);
    expect(nodes[0].hasChildren).toBe(true);
    expect(nodes[2].hasChildren).toBe(false);
    // straight from the DB count, never a placeholder
    expect(nodes.map((n) => n.assignedCount)).toEqual([0, 1, 2]);
    expect(nodes[0].createdByName).toBeNull();
    expect(nodes[1].createdByName).toBe('Emarath Admin');
  });

  it('excludes soft-deleted roles (CLAUDE.md §11 — no automatic filter)', async () => {
    const { service, roleFindMany } = makeService();
    roleFindMany.mockResolvedValue([]);

    await service.list();

    expect(roleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});

/** The mock argument shapes these assertions read back. */
interface PrismaCall {
  where?: { id: string };
  data: Record<string, unknown>;
}

describe('RolesService.create', () => {
  it('stamps the author and appends after the last sibling', async () => {
    const { service, roleFindMany, roleFindFirst, roleCreate } = makeService();
    roleFindMany.mockResolvedValueOnce(graph()).mockResolvedValue(fullRows());
    roleFindFirst.mockResolvedValue(null);
    roleCreate.mockResolvedValue({
      id: CHILD,
      name: 'User',
      baseRole: UserRole.SALES_AGENT,
      parentId: ROOT,
    });

    await service.create({
      name: 'User',
      baseRole: UserRole.SALES_AGENT,
      parentId: ROOT,
    });

    const [created] = roleCreate.mock.calls[0] as [PrismaCall];
    expect(created.data).toMatchObject({
      name: 'User',
      parentId: ROOT,
      createdById: ADMIN,
      position: 1,
    });
  });

  it('rejects a duplicate name with a 409 rather than a database 500', async () => {
    const { service, roleFindMany, roleFindFirst } = makeService();
    roleFindMany.mockResolvedValue(graph());
    roleFindFirst.mockResolvedValue({ id: ROOT, deletedAt: null });

    await expect(
      service.create({
        name: 'Account Holder',
        baseRole: UserRole.SALES_AGENT,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('says so when the name belonged to a removed role (unique index spans soft deletes)', async () => {
    const { service, roleFindMany, roleFindFirst } = makeService();
    roleFindMany.mockResolvedValue(graph());
    roleFindFirst.mockResolvedValue({ id: ROOT, deletedAt: new Date() });

    await expect(
      service.create({ name: 'Gone', baseRole: UserRole.SALES_AGENT }),
    ).rejects.toThrow(/removed role/i);
  });

  it('404s when the parent does not exist', async () => {
    const { service, roleFindMany, roleFindFirst } = makeService();
    roleFindMany.mockResolvedValue(graph());
    roleFindFirst.mockResolvedValue(null);

    await expect(
      service.create({
        name: 'Orphan',
        baseRole: UserRole.SALES_AGENT,
        parentId: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a seventh level — the reference legend defines exactly six', async () => {
    const { service, roleFindMany, roleFindFirst } = makeService();
    // a straight chain already six deep
    const chain = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`,
      name: `L${i + 1}`,
      parentId: i === 0 ? null : `f${i - 1}`,
      position: 0,
    }));
    roleFindMany.mockResolvedValue(chain);
    roleFindFirst.mockResolvedValue(null);

    await expect(
      service.create({
        name: 'L7',
        baseRole: UserRole.SALES_AGENT,
        parentId: 'f5',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RolesService.update — hierarchy invariants', () => {
  it('refuses to make a role its own parent', async () => {
    const { service, roleFindMany } = makeService();
    roleFindMany.mockResolvedValue(graph());

    await expect(service.update(ROOT, { parentId: ROOT })).rejects.toThrow(
      /own parent/i,
    );
  });

  it('refuses a cycle: moving a role beneath its own descendant', async () => {
    const { service, roleFindMany } = makeService();
    roleFindMany.mockResolvedValue(graph());

    await expect(
      service.update(ROOT, { parentId: GRANDCHILD }),
    ).rejects.toThrow(/descendant/i);
  });

  it('promotes to root when parentId is explicitly null', async () => {
    const { service, roleFindMany, roleUpdate } = makeService();
    roleFindMany.mockResolvedValueOnce(graph()).mockResolvedValue(fullRows());
    roleUpdate.mockResolvedValue({ id: CHILD });

    await service.update(CHILD, { parentId: null });

    const [detached] = roleUpdate.mock.calls[0] as [PrismaCall];
    expect(detached.data).toMatchObject({ parent: { disconnect: true } });
  });

  it('leaves the parent alone when parentId is omitted', async () => {
    const { service, roleFindMany, roleFindFirst, roleUpdate } = makeService();
    roleFindMany.mockResolvedValueOnce(graph()).mockResolvedValue(fullRows());
    roleFindFirst.mockResolvedValue(null);
    roleUpdate.mockResolvedValue({ id: CHILD });

    await service.update(CHILD, { name: 'Renamed' });

    const [renamed] = roleUpdate.mock.calls[0] as [PrismaCall];
    expect(renamed.data).not.toHaveProperty('parent');
    expect(renamed.data.name).toBe('Renamed');
  });
});

describe('RolesService — history (AUD-01)', () => {
  it('records a new role as CREATED, by its author', async () => {
    const mocks = makeService();
    mocks.roleFindMany
      .mockResolvedValueOnce(graph())
      .mockResolvedValue(fullRows());
    mocks.roleFindFirst.mockResolvedValue(null);
    mocks.roleCreate.mockResolvedValue({
      id: CHILD,
      name: 'User',
      baseRole: UserRole.SALES_AGENT,
      parentId: ROOT,
    });

    await mocks.service.create({
      name: 'User',
      baseRole: UserRole.SALES_AGENT,
      parentId: ROOT,
    });

    expect(mocks.auditCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entityType: 'ROLE',
          entityId: CHILD,
          leadId: null,
          action: 'CREATED',
          actorType: 'USER',
          actorId: ADMIN,
          source: 'roles.create',
          after: { name: 'User', baseRole: 'SALES_AGENT', parentId: ROOT },
        }),
      ],
    });
  });

  it('records what an edit changed — a new base role is what the members get', async () => {
    const mocks = makeService();
    mocks.roleFindMany
      .mockResolvedValueOnce(graph())
      .mockResolvedValue(fullRows());
    mocks.roleUpdate.mockResolvedValue({
      name: 'User',
      baseRole: UserRole.SALES_MANAGER,
      parentId: ROOT,
    });

    await mocks.service.update(CHILD, { baseRole: UserRole.SALES_MANAGER });

    expect(mocks.auditCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entityId: CHILD,
          action: 'UPDATED',
          source: 'roles.update',
          before: { baseRole: 'SALES_AGENT' },
          after: { baseRole: 'SALES_MANAGER' },
        }),
      ],
    });
  });

  it('records nothing for an edit that changes nothing', async () => {
    const mocks = makeService();
    mocks.roleFindMany
      .mockResolvedValueOnce(graph())
      .mockResolvedValue(fullRows());
    mocks.roleUpdate.mockResolvedValue({
      name: 'User',
      baseRole: UserRole.SALES_AGENT,
      parentId: ROOT,
    });

    await mocks.service.update(CHILD, { baseRole: UserRole.SALES_AGENT });

    expect(mocks.auditCreateMany).not.toHaveBeenCalled();
  });

  it('records a move on the dragged role only, with its old and new place', async () => {
    const mocks = makeService();
    mocks.roleFindMany
      .mockResolvedValueOnce(graph())
      .mockResolvedValue(fullRows());

    await mocks.service.move(GRANDCHILD, { parentId: null, position: 0 });

    expect(mocks.auditCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entityId: GRANDCHILD,
          action: 'MOVED',
          source: 'roles.move',
          before: { parentId: CHILD },
          after: { parentId: null },
        }),
      ],
    });
  });
});

describe('RolesService.move', () => {
  it('renumbers the destination siblings in one transaction', async () => {
    const { service, roleFindMany, transaction } = makeService();
    roleFindMany.mockResolvedValueOnce(graph()).mockResolvedValue(fullRows());

    await service.move(GRANDCHILD, { parentId: null, position: 0 });

    expect(transaction).toHaveBeenCalledTimes(1);
    // both roots plus the arriving role are rewritten together, with the move's history
    const [batch] = transaction.mock.calls[0] as [unknown[]];
    expect(batch).toHaveLength(3);
  });

  it('will not drop a role into its own subtree', async () => {
    const { service, roleFindMany } = makeService();
    roleFindMany.mockResolvedValue(graph());

    await expect(
      service.move(ROOT, { parentId: CHILD, position: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RolesService.remove', () => {
  it('refuses while child roles remain', async () => {
    const { service, roleFindMany } = makeService();
    roleFindMany.mockResolvedValue(graph());

    await expect(service.remove(ROOT)).rejects.toThrow(/roles beneath it/i);
  });

  it('refuses while team members still hold the role', async () => {
    const { service, roleFindMany, userCount } = makeService();
    roleFindMany.mockResolvedValue(graph());
    userCount.mockResolvedValue(3);

    await expect(service.remove(GRANDCHILD)).rejects.toThrow(
      /assigned to 3 team members/i,
    );
  });

  it('soft-deletes an unused leaf rather than erasing the row', async () => {
    const { service, roleFindMany, userCount, roleUpdateMany } = makeService();
    roleFindMany.mockResolvedValue(graph());
    userCount.mockResolvedValue(0);

    await expect(service.remove(GRANDCHILD)).resolves.toEqual({
      id: GRANDCHILD,
    });
    const [removed] = roleUpdateMany.mock.calls[0] as [
      PrismaCall & { where: { id: string; deletedAt: null } },
    ];
    expect(removed.where).toEqual({ id: GRANDCHILD, deletedAt: null });
    expect(removed.data.deletedAt).toBeInstanceOf(Date);
  });

  it('records the removal with the role as it stood; a removal that lost the race is a 404 and records nothing', async () => {
    const mocks = makeService();
    mocks.roleFindMany.mockResolvedValue(graph());
    mocks.userCount.mockResolvedValue(0);
    mocks.roleFindUniqueOrThrow.mockResolvedValue({
      name: 'Agent',
      baseRole: UserRole.SALES_AGENT,
      parentId: CHILD,
    });

    await mocks.service.remove(GRANDCHILD);
    expect(mocks.auditCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entityType: 'ROLE',
          entityId: GRANDCHILD,
          action: 'DELETED',
          actorId: ADMIN,
          source: 'roles.delete',
          before: { name: 'Agent', baseRole: 'SALES_AGENT', parentId: CHILD },
        }),
      ],
    });

    const late = makeService();
    late.roleFindMany.mockResolvedValue(graph());
    late.userCount.mockResolvedValue(0);
    late.roleUpdateMany.mockResolvedValue({ count: 0 });
    await expect(late.service.remove(GRANDCHILD)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(late.auditCreateMany).not.toHaveBeenCalled();
  });

  it('counts only live members when deciding (soft-deleted users do not block)', async () => {
    const { service, roleFindMany, userCount, roleUpdate } = makeService();
    roleFindMany.mockResolvedValue(graph());
    userCount.mockResolvedValue(0);
    roleUpdate.mockResolvedValue({ id: GRANDCHILD });

    await service.remove(GRANDCHILD);

    expect(userCount).toHaveBeenCalledWith({
      where: { roleId: GRANDCHILD, deletedAt: null },
    });
  });
});
