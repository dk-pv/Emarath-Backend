import { ForbiddenException } from '@nestjs/common';
import { TagAccessMode, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  PolicyRow,
  TAG_CREATE_NOT_PERMITTED,
  TAG_NOT_PERMITTED,
  TagAccessService,
} from './tag-access.service';

const A = 'tag-a';
const B = 'tag-b';
const C = 'tag-c';

const agent: CurrentUser = {
  id: 'agent-1',
  role: UserRole.SALES_AGENT,
  // The access token's claim. The service must NOT trust it over the database.
  team: 'Sales',
};

function teamPolicy(
  name: string,
  over: Partial<PolicyRow> & { tagIds?: string[] } = {},
): PolicyRow {
  const { tagIds = [], ...rest } = over;
  return {
    id: `policy-${name}`,
    team: name,
    userId: null,
    canCreate: false,
    tagAccess: TagAccessMode.ALL,
    grants: tagIds.map((tagId) => ({ tagId })),
    ...rest,
  };
}

function override(
  userId: string,
  over: Partial<PolicyRow> & { tagIds?: string[] } = {},
): PolicyRow {
  const { tagIds = [], ...rest } = over;
  return {
    id: `policy-${userId}`,
    team: null,
    userId,
    canCreate: null,
    tagAccess: null,
    grants: tagIds.map((tagId) => ({ tagId })),
    ...rest,
  };
}

function setup(options: { team?: string | null; policies?: PolicyRow[] } = {}) {
  const { team = 'Support', policies = [] } = options;
  const userFindFirst = jest.fn().mockResolvedValue({ team });
  const policyFindMany = jest.fn().mockResolvedValue(policies);
  const tagFindMany = jest.fn().mockResolvedValue([]);
  const grantCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    user: { findFirst: userFindFirst },
    tagAccessPolicy: { findMany: policyFindMany },
    tag: { findMany: tagFindMany },
  } as unknown as PrismaService;
  const service = new TagAccessService(prisma);
  const tx = {
    user: { findFirst: userFindFirst },
    tagAccessPolicy: { findMany: policyFindMany },
    tagAccessGrant: { create: grantCreate },
  } as never;
  return {
    service,
    tx,
    userFindFirst,
    policyFindMany,
    tagFindMany,
    grantCreate,
  };
}

describe('TagAccessService — administrators', () => {
  it('lets an administrator use and create any tag without reading any policy', async () => {
    const { service, userFindFirst, policyFindMany } = setup();
    const admin: CurrentUser = { id: 'admin', role: UserRole.SUPERADMIN };

    await expect(
      service.assertMayHandle(admin, [A, B]),
    ).resolves.toBeUndefined();
    await expect(service.assertMayCreate(admin)).resolves.toBeUndefined();
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(policyFindMany).not.toHaveBeenCalled();
  });
});

describe('TagAccessService.assertMayHandle — tag selection', () => {
  it('allows every tag when no policy applies (the compatibility default)', async () => {
    const { service } = setup({ policies: [] });
    await expect(
      service.assertMayHandle(agent, [A, B, C]),
    ).resolves.toBeUndefined();
  });

  it('allows a tag the team list grants', async () => {
    const { service } = setup({
      policies: [
        teamPolicy('Support', {
          tagAccess: TagAccessMode.LISTED,
          tagIds: [A, B],
        }),
      ],
    });
    await expect(service.assertMayHandle(agent, [A])).resolves.toBeUndefined();
  });

  it('refuses a tag the team list does not grant, with a 403', async () => {
    const { service } = setup({
      policies: [
        teamPolicy('Support', {
          tagAccess: TagAccessMode.LISTED,
          tagIds: [A, B],
        }),
      ],
    });
    const attempt = service.assertMayHandle(agent, [C]);
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(TAG_NOT_PERMITTED);
  });

  it('refuses the whole request when only one of several tags is outside the list', async () => {
    const { service } = setup({
      policies: [
        teamPolicy('Support', { tagAccess: TagAccessMode.LISTED, tagIds: [A] }),
      ],
    });
    await expect(service.assertMayHandle(agent, [A, C])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('asks nothing when there are no tags to check', async () => {
    const { service, userFindFirst } = setup();
    await service.assertMayHandle(agent, []);
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('applies the user override over the team list', async () => {
    const { service } = setup({
      policies: [
        teamPolicy('Support', { tagAccess: TagAccessMode.LISTED, tagIds: [A] }),
        override(agent.id, { tagAccess: TagAccessMode.LISTED, tagIds: [C] }),
      ],
    });
    await expect(service.assertMayHandle(agent, [C])).resolves.toBeUndefined();
    await expect(service.assertMayHandle(agent, [A])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('takes the team from the database, not from the access token claim', async () => {
    // The token still says "Sales"; the database says the user moved to "Support".
    const { service, policyFindMany } = setup({ team: 'Support' });
    await service.assertMayHandle(agent, [A]);

    const args = policyFindMany.mock.calls[0] as [
      { where: { OR: Record<string, string>[] } },
    ];
    expect(args[0].where.OR).toEqual([
      { userId: 'agent-1' },
      { team: 'Support' },
    ]);
  });

  it('looks up only the user override when the user belongs to no team', async () => {
    const { service, policyFindMany } = setup({ team: null });
    await service.assertMayHandle(agent, [A]);

    const args = policyFindMany.mock.calls[0] as [
      { where: { OR: Record<string, string>[] } },
    ];
    expect(args[0].where.OR).toEqual([{ userId: 'agent-1' }]);
  });
});

describe('TagAccessService.handleable', () => {
  it('keeps only the tags the caller may select, preserving order', async () => {
    const { service } = setup({
      policies: [
        teamPolicy('Support', {
          tagAccess: TagAccessMode.LISTED,
          tagIds: [A, C],
        }),
      ],
    });
    await expect(service.handleable(agent, [C, B, A])).resolves.toEqual([C, A]);
  });

  it('returns nothing without a query when given nothing', async () => {
    const { service, userFindFirst } = setup();
    await expect(service.handleable(agent, [])).resolves.toEqual([]);
    expect(userFindFirst).not.toHaveBeenCalled();
  });
});

describe('TagAccessService.assertMayCreate — tag creation', () => {
  it('refuses by default: only an administrator creates tags until the Admin allows it', async () => {
    const { service } = setup({ policies: [] });
    const attempt = service.assertMayCreate(agent);
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(TAG_CREATE_NOT_PERMITTED);
  });

  it('allows a user whose team may create', async () => {
    const { service } = setup({
      policies: [teamPolicy('Support', { canCreate: true })],
    });
    await expect(service.assertMayCreate(agent)).resolves.toBeUndefined();
  });

  it('lets a user override take creation away from a team that has it', async () => {
    const { service } = setup({
      policies: [
        teamPolicy('Support', { canCreate: true }),
        override(agent.id, { canCreate: false }),
      ],
    });
    await expect(service.assertMayCreate(agent)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets a user override grant creation to a team that lacks it', async () => {
    const { service } = setup({
      policies: [
        teamPolicy('Support', { canCreate: false }),
        override(agent.id, { canCreate: true }),
      ],
    });
    await expect(service.assertMayCreate(agent)).resolves.toBeUndefined();
  });
});

describe('TagAccessService.grantToCreator', () => {
  it('adds the new tag to the team list that governs the creator', async () => {
    const { service, tx, grantCreate } = setup({
      policies: [
        teamPolicy('Support', {
          canCreate: true,
          tagAccess: TagAccessMode.LISTED,
          tagIds: [A],
        }),
      ],
    });
    await service.grantToCreator(tx, agent, 'new-tag');
    expect(grantCreate).toHaveBeenCalledWith({
      data: { policyId: 'policy-Support', tagId: 'new-tag' },
    });
  });

  it('adds it to the creator’s own override when that is what governs them', async () => {
    const { service, tx, grantCreate } = setup({
      policies: [
        teamPolicy('Support', { tagAccess: TagAccessMode.LISTED, tagIds: [A] }),
        override(agent.id, { tagAccess: TagAccessMode.LISTED, tagIds: [B] }),
      ],
    });
    await service.grantToCreator(tx, agent, 'new-tag');
    // Only their own list grows — the team's other members gain nothing.
    expect(grantCreate).toHaveBeenCalledTimes(1);
    expect(grantCreate).toHaveBeenCalledWith({
      data: { policyId: `policy-${agent.id}`, tagId: 'new-tag' },
    });
  });

  it('grants nothing to a creator who can already select every tag', async () => {
    const { service, tx, grantCreate } = setup({
      policies: [teamPolicy('Support', { canCreate: true })],
    });
    await service.grantToCreator(tx, agent, 'new-tag');
    expect(grantCreate).not.toHaveBeenCalled();
  });

  it('does not widen the team when the creator’s own ALL override governs', async () => {
    const { service, tx, grantCreate } = setup({
      policies: [
        teamPolicy('Support', { tagAccess: TagAccessMode.LISTED, tagIds: [A] }),
        override(agent.id, { tagAccess: TagAccessMode.ALL }),
      ],
    });
    await service.grantToCreator(tx, agent, 'new-tag');
    expect(grantCreate).not.toHaveBeenCalled();
  });
});

describe('TagAccessService.mine — what the pickers render', () => {
  it('offers every active tag to an unrestricted user and reports they may not create', async () => {
    const { service, tagFindMany } = setup({ policies: [] });
    tagFindMany.mockResolvedValue([{ id: A, name: 'ALPHA' }]);

    const mine = await service.mine(agent);

    expect(mine).toEqual({
      canCreate: false,
      restricted: false,
      tags: [{ value: A, label: 'ALPHA' }],
    });
    const [args] = tagFindMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toEqual({ deletedAt: null, isActive: true });
  });

  it('offers a restricted user only their granted tags, still active and undeleted', async () => {
    const { service, tagFindMany } = setup({
      policies: [
        teamPolicy('Support', {
          canCreate: true,
          tagAccess: TagAccessMode.LISTED,
          tagIds: [A, B],
        }),
      ],
    });
    tagFindMany.mockResolvedValue([{ id: A, name: 'ALPHA' }]);

    const mine = await service.mine(agent);

    expect(mine.restricted).toBe(true);
    expect(mine.canCreate).toBe(true);
    const [args] = tagFindMany.mock.calls[0] as [
      { where: { id: { in: string[] }; deletedAt: null; isActive: boolean } },
    ];
    expect(args.where.id.in.sort()).toEqual([A, B]);
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.isActive).toBe(true);
  });

  it('reports an administrator as unrestricted and able to create', async () => {
    const { service, tagFindMany } = setup();
    tagFindMany.mockResolvedValue([]);
    const mine = await service.mine({ id: 'admin', role: UserRole.SUPERADMIN });
    expect(mine.canCreate).toBe(true);
    expect(mine.restricted).toBe(false);
  });
});
