import { ForbiddenException } from '@nestjs/common';
import { TagAccessMode, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyRow, TagAccessService } from './tag-access.service';
import { TagPermissionsService } from './tag-permissions.service';

/**
 * The three places that report what a user may do with tags — the Admin screen's "effective"
 * column (TagPermissionsService.overview), the picker's list (TagAccessService.mine) and the
 * checks that actually refuse a request (assertMayHandle / assertMayCreate) — are separate code
 * paths. They must never disagree, or the Admin would be shown one thing while the server does
 * another. This runs the same stored policies through all three, for every combination of a team
 * default and a user override that the precedence rule distinguishes (ADR-0091).
 */
const TAGS = ['tag-a', 'tag-b', 'tag-c'];
const USER: CurrentUser = {
  id: 'user-1',
  role: UserRole.SALES_AGENT,
  team: 'Sales',
};

type Spec = {
  canCreate: boolean | null;
  tagAccess: TagAccessMode | null;
  tagIds?: string[];
};

const policy = (
  who: { team: string } | { userId: string },
  spec: Spec,
): PolicyRow => ({
  id: 'team' in who ? `p-${who.team}` : `p-${who.userId}`,
  team: 'team' in who ? who.team : null,
  userId: 'userId' in who ? who.userId : null,
  canCreate: spec.canCreate,
  tagAccess: spec.tagAccess,
  grants: (spec.tagIds ?? []).map((tagId) => ({ tagId })),
});

function build(rows: PolicyRow[], team: string | null = 'Sales') {
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ team }),
      groupBy: jest
        .fn()
        .mockResolvedValue(team ? [{ team, _count: { _all: 1 } }] : []),
      findMany: jest.fn().mockResolvedValue([
        {
          id: USER.id,
          name: 'Subject',
          role: USER.role,
          team,
        },
      ]),
    },
    tagAccessPolicy: {
      // Behaves like the real query: the caller's own row and their team's row, or everything.
      findMany: jest.fn(
        (args: { where?: { OR: ({ userId: string } | { team: string })[] } }) =>
          Promise.resolve(
            args.where
              ? rows.filter((row) =>
                  args.where!.OR.some((clause) =>
                    'userId' in clause
                      ? row.userId === clause.userId
                      : row.team === clause.team,
                  ),
                )
              : rows,
          ),
      ),
    },
    tag: {
      findMany: jest.fn((args: { where: { id?: { in: string[] } } }) =>
        Promise.resolve(
          TAGS.filter(
            (id) => !args.where.id || args.where.id.in.includes(id),
          ).map((id) => ({ id, name: id.toUpperCase() })),
        ),
      ),
    },
  } as unknown as PrismaService;
  return {
    access: new TagAccessService(prisma),
    permissions: new TagPermissionsService(prisma),
  };
}

const ALL: Spec = { canCreate: true, tagAccess: TagAccessMode.ALL };
const A_B: Spec = {
  canCreate: false,
  tagAccess: TagAccessMode.LISTED,
  tagIds: ['tag-a', 'tag-b'],
};

const CASES: [string, Spec | null, Spec | null][] = [
  ['no team policy, no override (the default)', null, null],
  ['a LISTED team, no override', A_B, null],
  ['an ALL team that may create, no override', ALL, null],
  [
    'a LISTED team and an override that only grants creation',
    A_B,
    { canCreate: true, tagAccess: null },
  ],
  [
    'a LISTED team and an override that replaces the list',
    A_B,
    { canCreate: null, tagAccess: TagAccessMode.LISTED, tagIds: ['tag-c'] },
  ],
  [
    'a LISTED team and an ALL override',
    A_B,
    { canCreate: null, tagAccess: TagAccessMode.ALL },
  ],
  [
    'an ALL team and a LISTED override with nothing listed',
    ALL,
    { canCreate: false, tagAccess: TagAccessMode.LISTED, tagIds: [] },
  ],
  [
    'no team policy and a LISTED override',
    null,
    { canCreate: true, tagAccess: TagAccessMode.LISTED, tagIds: ['tag-b'] },
  ],
];

describe('Tag Permissions — the screen, the pickers and the server agree', () => {
  describe.each(CASES)('%s', (_name, teamSpec, userSpec) => {
    const rows = [
      ...(teamSpec ? [policy({ team: 'Sales' }, teamSpec)] : []),
      ...(userSpec ? [policy({ userId: USER.id }, userSpec)] : []),
    ];

    it('shows on the Admin screen exactly what the picker offers', async () => {
      const { access, permissions } = build(rows);

      const node = (await permissions.overview()).users[0];
      const mine = await access.mine(USER);

      const offered = mine.tags.map((tag) => tag.value).sort();
      const shown =
        node.effective.tagAccess === TagAccessMode.ALL
          ? [...TAGS]
          : [...node.effective.tagIds].sort();
      expect(offered).toEqual(shown);
      expect(mine.restricted).toBe(
        node.effective.tagAccess === TagAccessMode.LISTED,
      );
      expect(mine.canCreate).toBe(node.effective.canCreate);
    });

    it('refuses on the server exactly the tags the picker leaves out', async () => {
      const { access } = build(rows);
      const offered = new Set(
        (await access.mine(USER)).tags.map((tag) => tag.value),
      );

      for (const tagId of TAGS) {
        const attempt = access.assertMayHandle(USER, [tagId]);
        if (offered.has(tagId)) await expect(attempt).resolves.toBeUndefined();
        else await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('lets the user create a tag exactly when the screen and the picker say so', async () => {
      const { access, permissions } = build(rows);
      const shown = (await permissions.overview()).users[0].effective.canCreate;
      const attempt = access.assertMayCreate(USER);

      expect((await access.mine(USER)).canCreate).toBe(shown);
      if (shown) await expect(attempt).resolves.toBeUndefined();
      else await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('applies the user override and the team default to the same user in the same way for a user with no team', async () => {
    // No team: only the override can apply, and every path says so.
    const rows = [policy({ userId: USER.id }, A_B)];
    const { access, permissions } = build(rows, null);

    const node = (await permissions.overview()).users[0];
    const mine = await access.mine({ ...USER, team: null });

    expect(node.team).toBeNull();
    expect(mine.tags.map((tag) => tag.value).sort()).toEqual([
      'tag-a',
      'tag-b',
    ]);
    expect([...node.effective.tagIds].sort()).toEqual(['tag-a', 'tag-b']);
  });
});
