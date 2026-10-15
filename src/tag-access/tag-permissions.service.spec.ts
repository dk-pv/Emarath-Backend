import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TagAccessMode, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyRow } from './tag-access.service';
import { TagPermissionsService } from './tag-permissions.service';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

function policy(over: Partial<PolicyRow> & { tagIds?: string[] }): PolicyRow {
  const { tagIds = [], ...rest } = over;
  return {
    id: 'p1',
    team: null,
    userId: null,
    canCreate: null,
    tagAccess: null,
    grants: tagIds.map((tagId) => ({ tagId })),
    ...rest,
  };
}

function setup(
  data: {
    teams?: { team: string | null; _count: { _all: number } }[];
    users?: {
      id: string;
      name: string;
      role: UserRole;
      team: string | null;
    }[];
    policies?: PolicyRow[];
    target?: { role: UserRole } | null;
    tagCount?: number;
  } = {},
) {
  const groupBy = jest.fn().mockResolvedValue(data.teams ?? []);
  const userFindMany = jest.fn().mockResolvedValue(data.users ?? []);
  const userFindFirst = jest
    .fn()
    .mockResolvedValue(
      data.target === undefined ? { role: UserRole.SALES_AGENT } : data.target,
    );
  const policyFindMany = jest.fn().mockResolvedValue(data.policies ?? []);
  const upsert = jest.fn().mockResolvedValue({ id: 'saved-policy' });
  const policyDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const grantDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const grantCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const tagCount = jest.fn().mockResolvedValue(data.tagCount ?? 0);

  const tx = {
    tagAccessPolicy: { upsert },
    tagAccessGrant: {
      deleteMany: grantDeleteMany,
      createMany: grantCreateMany,
    },
  };
  const prisma = {
    user: { groupBy, findMany: userFindMany, findFirst: userFindFirst },
    tagAccessPolicy: { findMany: policyFindMany, deleteMany: policyDeleteMany },
    tag: { count: tagCount },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  } as unknown as PrismaService;

  return {
    service: new TagPermissionsService(prisma),
    upsert,
    policyDeleteMany,
    grantDeleteMany,
    grantCreateMany,
    tagCount,
    userFindMany,
    policyFindMany,
  };
}

describe('TagPermissionsService.overview', () => {
  it('lists every team, with unconfigured ones at the pre-feature default', async () => {
    const { service } = setup({
      teams: [
        { team: 'Sales', _count: { _all: 7 } },
        { team: 'Support', _count: { _all: 4 } },
      ],
    });

    const { teams } = await service.overview();

    expect(teams).toEqual([
      {
        team: 'Sales',
        memberCount: 7,
        configured: false,
        canCreate: false,
        tagAccess: TagAccessMode.ALL,
        tagIds: [],
      },
      {
        team: 'Support',
        memberCount: 4,
        configured: false,
        canCreate: false,
        tagAccess: TagAccessMode.ALL,
        tagIds: [],
      },
    ]);
  });

  it('shows a saved team policy, and keeps one whose team has emptied', async () => {
    const { service } = setup({
      teams: [{ team: 'Sales', _count: { _all: 2 } }],
      policies: [
        policy({
          id: 'p-sales',
          team: 'Sales',
          canCreate: true,
          tagAccess: TagAccessMode.LISTED,
          tagIds: [A],
        }),
        policy({
          id: 'p-old',
          team: 'Closed Team',
          canCreate: false,
          tagAccess: TagAccessMode.ALL,
        }),
      ],
    });

    const { teams } = await service.overview();

    expect(teams.map((d) => d.team)).toEqual(['Closed Team', 'Sales']);
    expect(teams[1]).toMatchObject({
      configured: true,
      canCreate: true,
      tagAccess: TagAccessMode.LISTED,
      tagIds: [A],
    });
    // A policy for a team nobody belongs to any more is still visible, so it can be reset.
    expect(teams[0]).toMatchObject({ memberCount: 0, configured: true });
  });

  it('computes each user’s effective permissions from team and override', async () => {
    const { service } = setup({
      teams: [{ team: 'Sales', _count: { _all: 2 } }],
      users: [
        {
          id: 'u-inherit',
          name: 'Inherits',
          role: UserRole.SALES_AGENT,
          team: 'Sales',
        },
        {
          id: 'u-override',
          name: 'Overridden',
          role: UserRole.SALES_AGENT,
          team: 'Sales',
        },
        {
          id: 'u-none',
          name: 'No Team',
          role: UserRole.SALES_AGENT,
          team: null,
        },
      ],
      policies: [
        policy({
          id: 'p-sales',
          team: 'Sales',
          canCreate: true,
          tagAccess: TagAccessMode.LISTED,
          tagIds: [A],
        }),
        policy({
          id: 'p-user',
          userId: 'u-override',
          canCreate: false,
          tagAccess: TagAccessMode.LISTED,
          tagIds: [B],
        }),
      ],
    });

    const { users } = await service.overview();
    const byId = Object.fromEntries(users.map((u) => [u.userId, u]));

    expect(byId['u-inherit'].override).toBeNull();
    expect(byId['u-inherit'].effective).toEqual({
      canCreate: true,
      tagAccess: TagAccessMode.LISTED,
      tagIds: [A],
    });
    expect(byId['u-override'].effective).toEqual({
      canCreate: false,
      tagAccess: TagAccessMode.LISTED,
      tagIds: [B],
    });
    expect(byId['u-override'].override).toEqual({
      canCreate: false,
      tagAccess: TagAccessMode.LISTED,
      tagIds: [B],
    });
    // No team, no override: the pre-feature default.
    expect(byId['u-none'].effective).toEqual({
      canCreate: false,
      tagAccess: TagAccessMode.ALL,
      tagIds: [],
    });
  });

  it('never offers an administrator or a post-sale role for an override', async () => {
    const { service, userFindMany } = setup();
    await service.overview();

    const [args] = userFindMany.mock.calls[0] as [
      { where: { role: { in: UserRole[] } } },
    ];
    expect(args.where.role.in).not.toContain(UserRole.SUPERADMIN);
    expect(args.where.role.in).not.toContain(UserRole.QC);
    expect(args.where.role.in).not.toContain(UserRole.LOGISTICS_MANAGER);
    expect(args.where.role.in).toContain(UserRole.SALES_AGENT);
  });
});

describe('TagPermissionsService.saveTeam', () => {
  it('upserts the policy by team and replaces its grants in one transaction', async () => {
    const { service, upsert, grantDeleteMany, grantCreateMany, tagCount } =
      setup({
        tagCount: 2,
      });

    await service.saveTeam({
      team: 'Sales',
      canCreate: true,
      tagAccess: TagAccessMode.LISTED,
      tagIds: [A, B],
    });

    expect(tagCount).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith({
      where: { team: 'Sales' },
      create: {
        team: 'Sales',
        canCreate: true,
        tagAccess: TagAccessMode.LISTED,
      },
      update: { canCreate: true, tagAccess: TagAccessMode.LISTED },
      select: { id: true },
    });
    expect(grantDeleteMany).toHaveBeenCalledWith({
      where: { policyId: 'saved-policy' },
    });
    expect(grantCreateMany).toHaveBeenCalledWith({
      data: [
        { policyId: 'saved-policy', tagId: A },
        { policyId: 'saved-policy', tagId: B },
      ],
    });
  });

  it('clears the grants when the team is switched to ALL', async () => {
    const { service, grantDeleteMany, grantCreateMany } = setup();

    await service.saveTeam({
      team: 'Sales',
      canCreate: false,
      tagAccess: TagAccessMode.ALL,
      // Sent by a stale form; must not be stored for an ALL policy.
      tagIds: [A],
    });

    expect(grantDeleteMany).toHaveBeenCalled();
    expect(grantCreateMany).not.toHaveBeenCalled();
  });

  it('rejects a tag that does not exist, before writing anything', async () => {
    const { service, upsert } = setup({ tagCount: 1 });

    await expect(
      service.saveTeam({
        team: 'Sales',
        canCreate: false,
        tagAccess: TagAccessMode.LISTED,
        tagIds: [A, B],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('TagPermissionsService.saveUser', () => {
  it('404s an unknown or deleted user', async () => {
    const { service, upsert } = setup({ target: null });

    await expect(
      service.saveUser(USER, { canCreate: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    UserRole.SUPERADMIN,
    UserRole.QC,
    UserRole.LOGISTICS_MANAGER,
    UserRole.ACCOUNTS_EXECUTIVE,
  ])('refuses an override for a %s', async (role) => {
    const { service, upsert } = setup({ target: { role } });

    await expect(
      service.saveUser(USER, { canCreate: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('stores only what is overridden and leaves the rest to inherit', async () => {
    const { service, upsert, grantCreateMany } = setup();

    await service.saveUser(USER, { canCreate: true });

    expect(upsert).toHaveBeenCalledWith({
      where: { userId: USER },
      create: {
        user: { connect: { id: USER } },
        canCreate: true,
        tagAccess: null,
      },
      update: { canCreate: true, tagAccess: null },
      select: { id: true },
    });
    expect(grantCreateMany).not.toHaveBeenCalled();
  });

  it('treats an override with nothing set as no override at all', async () => {
    const { service, upsert, policyDeleteMany } = setup();

    await service.saveUser(USER, { canCreate: null, tagAccess: null });

    expect(upsert).not.toHaveBeenCalled();
    expect(policyDeleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
  });

  it('stores a LISTED override’s tags after confirming they exist', async () => {
    const { service, grantCreateMany } = setup({ tagCount: 1 });

    await service.saveUser(USER, {
      tagAccess: TagAccessMode.LISTED,
      tagIds: [A],
    });

    expect(grantCreateMany).toHaveBeenCalledWith({
      data: [{ policyId: 'saved-policy', tagId: A }],
    });
  });

  it('rejects a LISTED override naming a tag that does not exist', async () => {
    const { service, upsert } = setup({ tagCount: 0 });

    await expect(
      service.saveUser(USER, { tagAccess: TagAccessMode.LISTED, tagIds: [A] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('TagPermissionsService resets', () => {
  it('deletes a team’s policy, which cascades its grants', async () => {
    const { service, policyDeleteMany } = setup();
    await service.resetTeam('Sales');
    expect(policyDeleteMany).toHaveBeenCalledWith({
      where: { team: 'Sales' },
    });
  });

  it('deletes a user’s override so they inherit again', async () => {
    const { service, policyDeleteMany } = setup();
    await service.resetUser(USER);
    expect(policyDeleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
  });
});
