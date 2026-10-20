import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { ROLES_KEY } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { normalizeTeamName } from './team-label';
import { AssignTeamDto, CreateTeamDto, RenameTeamDto } from './dto/team.dto';
import { UpdateUserDto } from './dto/user.dto';

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const ids = {
  ana: '00000000-0000-4000-8000-000000000001',
  ben: '00000000-0000-4000-8000-000000000002',
  cy: '00000000-0000-4000-8000-000000000003',
  dee: '00000000-0000-4000-8000-000000000004',
  eve: '00000000-0000-4000-8000-000000000005',
  gone: '00000000-0000-4000-8000-000000000006',
  logi: '00000000-0000-4000-8000-000000000007',
};

interface FakeUser {
  id: string;
  name: string;
  role: UserRole;
  team: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  monthlyGoalAmount: Prisma.Decimal | null;
}

interface FakePolicy {
  id: string;
  team: string | null;
  userId: string | null;
}

type TeamFilter =
  | string
  | null
  | { equals?: string; mode?: 'insensitive'; not?: null; in?: string[] };

interface UserWhere {
  id?: { in: string[] };
  deletedAt?: null;
  isActive?: boolean;
  role?: { in: UserRole[] };
  team?: TeamFilter;
  NOT?: { team: string };
}

function teamMatches(team: string | null, filter: TeamFilter): boolean {
  if (filter === null) return team === null;
  if (typeof filter === 'string') return team === filter;
  if (filter.in) return team !== null && filter.in.includes(team);
  if (filter.not === null && filter.equals === undefined) return team !== null;
  if (filter.equals !== undefined) {
    if (team === null) return false;
    return filter.mode === 'insensitive'
      ? team.toLowerCase() === filter.equals.toLowerCase()
      : team === filter.equals;
  }
  return true;
}

function matches(user: FakeUser, where: UserWhere = {}): boolean {
  if (where.deletedAt === null && user.deletedAt !== null) return false;
  if (where.id && !where.id.in.includes(user.id)) return false;
  if (where.isActive !== undefined && user.isActive !== where.isActive)
    return false;
  if (where.role && !where.role.in.includes(user.role)) return false;
  if ('team' in where && !teamMatches(user.team, where.team as TeamFilter))
    return false;
  if (where.NOT && user.team === where.NOT.team) return false;
  return true;
}

const user = (
  id: string,
  name: string,
  team: string | null,
  over: Partial<FakeUser> = {},
): FakeUser => ({
  id,
  name,
  role: UserRole.SALES_AGENT,
  team,
  isActive: true,
  deletedAt: null,
  monthlyGoalAmount: null,
  ...over,
});

/**
 * An in-memory stand-in for the slice of Prisma the service uses, so each test reads as what the
 * accounts and policies hold before and after — not as which calls were made.
 */
function makeService(
  users: FakeUser[],
  policies: FakePolicy[] = [],
  failAudit = false,
) {
  const audit: Prisma.AuditEventCreateManyInput[] = [];
  const locks: string[] = [];
  const pick = (row: FakeUser) => ({
    ...row,
    orgRole: { name: row.role },
  });

  const db = {
    $executeRaw: jest.fn((strings: TemplateStringsArray) => {
      locks.push(strings.join('?'));
      return Promise.resolve(1);
    }),
    $queryRaw: jest.fn((_strings: TemplateStringsArray, ...values: string[]) =>
      Promise.resolve(
        policies.filter(
          (policy) => policy.team !== null && values.includes(policy.team),
        ),
      ),
    ),
    user: {
      findFirst: jest.fn(
        (args: { where: UserWhere; orderBy?: { team: 'asc' } }) => {
          const found = users
            .filter((row) => matches(row, args.where))
            .sort((a, b) => (a.team ?? '').localeCompare(b.team ?? ''));
          return Promise.resolve(found[0] ?? null);
        },
      ),
      findMany: jest.fn((args: { where?: UserWhere; take?: number }) =>
        Promise.resolve(
          users
            .filter((row) => matches(row, args.where))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, args.take ?? Infinity)
            .map(pick),
        ),
      ),
      updateMany: jest.fn(
        (args: { where: UserWhere; data: { team: string | null } }) => {
          const hit = users.filter((row) => matches(row, args.where));
          for (const row of hit) row.team = args.data.team;
          return Promise.resolve({ count: hit.length });
        },
      ),
      count: jest.fn((args: { where: UserWhere }) =>
        Promise.resolve(users.filter((row) => matches(row, args.where)).length),
      ),
      groupBy: jest.fn(
        (args: { by: string[]; where: UserWhere; _sum?: object }) => {
          const live = users.filter((row) => matches(row, args.where));
          const keyOf = (row: FakeUser) =>
            args.by.map((field) => String(row[field as keyof FakeUser]));
          const groups = new Map<string, FakeUser[]>();
          for (const row of live) {
            const key = JSON.stringify(keyOf(row));
            groups.set(key, [...(groups.get(key) ?? []), row]);
          }
          return Promise.resolve(
            [...groups.values()].map((rows) => ({
              team: rows[0].team,
              isActive: rows[0].isActive,
              _count: { _all: rows.length },
              _sum: {
                monthlyGoalAmount: rows.reduce<Prisma.Decimal | null>(
                  (sum, row) =>
                    row.monthlyGoalAmount
                      ? (sum ?? new Prisma.Decimal(0)).add(
                          row.monthlyGoalAmount,
                        )
                      : sum,
                  null,
                ),
              },
            })),
          );
        },
      ),
    },
    tagAccessPolicy: {
      findMany: jest.fn(() =>
        Promise.resolve(policies.filter((policy) => policy.team !== null)),
      ),
      update: jest.fn(
        (args: { where: { id: string }; data: { team: string } }) => {
          const policy = policies.find((row) => row.id === args.where.id);
          if (policy) policy.team = args.data.team;
          return Promise.resolve(policy);
        },
      ),
    },
    auditEvent: {
      createMany: jest.fn(
        (args: { data: Prisma.AuditEventCreateManyInput[] }) => {
          if (failAudit) return Promise.reject(new Error('audit write failed'));
          audit.push(...args.data);
          return Promise.resolve({ count: args.data.length });
        },
      ),
    },
  };

  // A transaction runs against the same fake; a throw leaves the snapshot taken before it.
  const prisma = {
    ...db,
    $transaction: jest.fn(async (run: (tx: typeof db) => Promise<unknown>) => {
      const snapshot = users.map((row) => ({ ...row }));
      const policySnapshot = policies.map((row) => ({ ...row }));
      try {
        return await run(db);
      } catch (error) {
        users.splice(0, users.length, ...snapshot);
        policies.splice(0, policies.length, ...policySnapshot);
        throw error;
      }
    }),
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: ADMIN, role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;

  return {
    service: new TeamsService(prisma, currentUser),
    users,
    policies,
    audit,
    locks,
  };
}

function teamOf(users: FakeUser[], id: string): string | null {
  return users.find((row) => row.id === id)?.team ?? null;
}

const roster = () => [
  user(ids.ana, 'Ana', 'Alpha', {
    monthlyGoalAmount: new Prisma.Decimal('3000'),
  }),
  user(ids.ben, 'Ben', 'Alpha', {
    role: UserRole.SALES_MANAGER,
    monthlyGoalAmount: new Prisma.Decimal('1000.50'),
  }),
  user(ids.cy, 'Cy', 'Bravo', {
    isActive: false,
    monthlyGoalAmount: new Prisma.Decimal('9999'),
  }),
  user(ids.dee, 'Dee', null),
  user(ids.eve, 'Eve', null, { role: UserRole.CUSTOMER_SERVICE_AGENT }),
  user(ids.gone, 'Gone', 'Alpha', { deletedAt: new Date('2026-09-01') }),
  user(ids.logi, 'Logi', null, { role: UserRole.LOGISTICS_EXECUTIVE }),
];

describe('TeamsService.overview', () => {
  it('lists each live team with its members, active members, managers and the active members’ goal total', async () => {
    const { service } = makeService(roster(), [
      { id: 'p1', team: 'Alpha', userId: null },
    ]);

    const { teams } = await service.overview();

    expect(teams).toEqual([
      {
        name: 'Alpha',
        memberCount: 2,
        activeMemberCount: 2,
        targetTotal: '4000.5',
        managers: ['Ben'],
        tagPermissions: true,
      },
      {
        name: 'Bravo',
        memberCount: 1,
        activeMemberCount: 0,
        // The only member is inactive, so nobody's goal counts toward the target.
        targetTotal: null,
        managers: [],
        tagPermissions: false,
      },
    ]);
  });

  it('marks who may join a team and counts the sales users in none', async () => {
    const { service } = makeService(roster());

    const { members, unassigned } = await service.overview();

    expect(members.map((member) => [member.name, member.eligible])).toEqual([
      ['Ana', true],
      ['Ben', true],
      ['Cy', true],
      ['Dee', true],
      ['Eve', true],
      ['Logi', false],
    ]);
    // Dee and Eve: sales users with no team. Logi is not a sales user; Gone is removed.
    expect(unassigned).toBe(2);
  });

  it('is empty, not an error, when nobody belongs to a team', async () => {
    const { service } = makeService([user(ids.dee, 'Dee', null)]);

    const overview = await service.overview();

    expect(overview.teams).toEqual([]);
    expect(overview.unassigned).toBe(1);
  });
});

describe('TeamsService.create', () => {
  it('creates a team with its first members, moving them out of any other team, and records each move', async () => {
    const { service, users, audit, locks } = makeService(roster());

    const overview = await service.create({
      name: 'Charlie',
      memberIds: [ids.dee, ids.ana],
    });

    expect(teamOf(users, ids.dee)).toBe('Charlie');
    expect(teamOf(users, ids.ana)).toBe('Charlie');
    expect(overview.teams.map((team) => team.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(locks).toHaveLength(1);
    expect(
      audit.map((event) => [
        event.entityId,
        event.action,
        event.before,
        event.after,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [ids.dee, 'UPDATED', { team: null }, { team: 'Charlie' }],
        [ids.ana, 'UPDATED', { team: 'Alpha' }, { team: 'Charlie' }],
      ]),
    );
    expect(audit.every((event) => event.source === 'teams.create')).toBe(true);
    expect(audit.every((event) => event.actorId === ADMIN)).toBe(true);
  });

  it.each(['Alpha', 'alpha', 'ALPHA'])(
    'refuses %s: a team by that name already exists, whatever its case',
    async (name) => {
      const { service, users, audit } = makeService(roster());

      await expect(
        service.create({ name, memberIds: [ids.dee] }),
      ).rejects.toThrow(ConflictException);
      expect(teamOf(users, ids.dee)).toBeNull();
      expect(audit).toHaveLength(0);
    },
  );

  it('reuses the name of a team whose only remaining members were removed', async () => {
    // Gone is deleted, so "Delta" names no live team.
    const users = [
      user(ids.dee, 'Dee', null),
      user(ids.gone, 'Gone', 'Delta', { deletedAt: new Date() }),
    ];
    const { service } = makeService(users);

    await service.create({ name: 'Delta', memberIds: [ids.dee] });

    expect(teamOf(users, ids.dee)).toBe('Delta');
  });

  it('refuses a member who does not exist or was removed, and changes nobody', async () => {
    const { service, users, audit } = makeService(roster());

    await expect(
      service.create({ name: 'Charlie', memberIds: [ids.dee, ids.gone] }),
    ).rejects.toThrow(BadRequestException);
    expect(teamOf(users, ids.dee)).toBeNull();
    expect(audit).toHaveLength(0);
  });

  it('refuses a post-sale role or the administrator, naming them', async () => {
    const users = [
      ...roster(),
      user(ADMIN, 'Admin', null, { role: UserRole.SUPERADMIN }),
    ];
    const { service } = makeService(users);

    await expect(
      service.create({ name: 'Charlie', memberIds: [ids.dee, ids.logi] }),
    ).rejects.toThrow(/Logi cannot join a team/);
    await expect(
      service.create({ name: 'Charlie', memberIds: [ADMIN] }),
    ).rejects.toThrow(/Admin cannot join a team/);
    expect(teamOf(users, ids.dee)).toBeNull();
  });
});

describe('TeamsService.rename', () => {
  it('renames every member — removed ones too, so their past leads follow — and records each', async () => {
    const { service, users, audit } = makeService(roster());

    await service.rename({ name: 'Alpha', newName: 'Alpha Squad' });

    expect(teamOf(users, ids.ana)).toBe('Alpha Squad');
    expect(teamOf(users, ids.ben)).toBe('Alpha Squad');
    expect(teamOf(users, ids.gone)).toBe('Alpha Squad');
    expect(audit.map((event) => event.entityId).sort()).toEqual(
      [ids.ana, ids.ben, ids.gone].sort(),
    );
    expect(audit.every((event) => event.source === 'teams.rename')).toBe(true);
  });

  it('carries the team’s Tag Permissions to the new name and records that as RENAMED', async () => {
    const policies: FakePolicy[] = [
      { id: 'p1', team: 'Alpha', userId: null },
      { id: 'p2', team: null, userId: ids.ana },
    ];
    const { service, audit } = makeService(roster(), policies);

    await service.rename({ name: 'Alpha', newName: 'Alpha Squad' });

    expect(policies).toEqual([
      { id: 'p1', team: 'Alpha Squad', userId: null },
      { id: 'p2', team: null, userId: ids.ana },
    ]);
    expect(
      audit.find((event) => event.entityType === 'TAG_ACCESS_POLICY'),
    ).toMatchObject({
      entityId: 'p1',
      action: 'RENAMED',
      before: { team: 'Alpha' },
      after: { team: 'Alpha Squad' },
    });
  });

  it('finds the team whatever the case typed, and allows a rename that only changes its case', async () => {
    const { service, users } = makeService(roster());

    await service.rename({ name: 'alpha', newName: 'ALPHA' });

    expect(teamOf(users, ids.ana)).toBe('ALPHA');
  });

  it('refuses a name another team already has, in any case — renaming is not merging', async () => {
    const { service, users, audit } = makeService(roster());

    await expect(
      service.rename({ name: 'Alpha', newName: 'bravo' }),
    ).rejects.toThrow(ConflictException);
    expect(teamOf(users, ids.ana)).toBe('Alpha');
    expect(audit).toHaveLength(0);
  });

  it('refuses a name Tag Permissions already holds a policy for, so two policies never meet', async () => {
    const policies: FakePolicy[] = [
      { id: 'p1', team: 'Alpha', userId: null },
      { id: 'p9', team: 'Old Alpha', userId: null },
    ];
    const { service, users } = makeService(roster(), policies);

    await expect(
      service.rename({ name: 'Alpha', newName: 'Old Alpha' }),
    ).rejects.toThrow(/Tag permissions are already saved/);
    expect(teamOf(users, ids.ana)).toBe('Alpha');
    expect(policies[0].team).toBe('Alpha');
  });

  it('404s a team that does not exist, and records nothing for the same name', async () => {
    const { service, audit } = makeService(roster());

    await expect(
      service.rename({ name: 'Zulu', newName: 'Yankee' }),
    ).rejects.toThrow(NotFoundException);
    await service.rename({ name: 'Alpha', newName: 'Alpha' });
    expect(audit).toHaveLength(0);
  });

  it('changes nothing when its history cannot be written', async () => {
    const { service, users, policies } = makeService(
      roster(),
      [{ id: 'p1', team: 'Alpha', userId: null }],
      true,
    );

    await expect(
      service.rename({ name: 'Alpha', newName: 'Alpha Squad' }),
    ).rejects.toThrow('audit write failed');
    expect(teamOf(users, ids.ana)).toBe('Alpha');
    expect(policies[0].team).toBe('Alpha');
  });
});

describe('TeamsService.assign', () => {
  it('moves a member from one team to another — one team per person — and records the move', async () => {
    const { service, users, audit } = makeService(roster());

    await service.assign({ team: 'Bravo', userIds: [ids.ana] });

    expect(teamOf(users, ids.ana)).toBe('Bravo');
    expect(audit).toEqual([
      expect.objectContaining({
        entityId: ids.ana,
        action: 'UPDATED',
        source: 'teams.assign',
        before: { team: 'Alpha' },
        after: { team: 'Bravo' },
      }),
    ]);
  });

  it('assigns to the stored spelling when the case differs', async () => {
    const { service, users } = makeService(roster());

    await service.assign({ team: 'bravo', userIds: [ids.dee] });

    expect(teamOf(users, ids.dee)).toBe('Bravo');
  });

  it('records nothing for someone already in the team', async () => {
    const { service, audit } = makeService(roster());

    await service.assign({ team: 'Alpha', userIds: [ids.ana] });

    expect(audit).toHaveLength(0);
  });

  it('takes people out of their team with null; the last member out ends the team', async () => {
    const { service, users } = makeService(roster());

    const overview = await service.assign({ team: null, userIds: [ids.cy] });

    expect(teamOf(users, ids.cy)).toBeNull();
    expect(overview.teams.map((team) => team.name)).toEqual(['Alpha']);
  });

  it('lets a post-sale account be taken out of a team it should never have been in', async () => {
    const users = [
      user(ids.logi, 'Logi', 'Alpha', { role: UserRole.LOGISTICS_EXECUTIVE }),
    ];
    const { service } = makeService(users);

    await service.assign({ team: null, userIds: [ids.logi] });

    expect(teamOf(users, ids.logi)).toBeNull();
  });

  it('404s a team that does not exist rather than creating it', async () => {
    const { service, users } = makeService(roster());

    await expect(
      service.assign({ team: 'Zulu', userIds: [ids.dee] }),
    ).rejects.toThrow(NotFoundException);
    expect(teamOf(users, ids.dee)).toBeNull();
  });

  it('refuses an unknown member and a post-sale role', async () => {
    const { service } = makeService(roster());

    await expect(
      service.assign({
        team: 'Alpha',
        userIds: ['00000000-0000-4000-8000-0000000000ff'],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.assign({ team: 'Alpha', userIds: [ids.logi] }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('Team names', () => {
  it('normalises whitespace the same way everywhere', () => {
    expect(normalizeTeamName('  UAE   Team\t2 ')).toBe('UAE Team 2');
  });

  const check = async <T extends object>(
    dto: new () => T,
    raw: Record<string, unknown>,
  ) => {
    const instance = plainToInstance(dto, raw);
    return { instance, errors: await validate(instance) };
  };

  it('accepts and normalises a valid create, rename and assign', async () => {
    const create = await check(CreateTeamDto, {
      name: '  Sales   North ',
      memberIds: [ids.ana],
    });
    expect(create.errors).toHaveLength(0);
    expect(create.instance.name).toBe('Sales North');
    expect(
      (await check(RenameTeamDto, { name: 'A', newName: ' B ' })).errors,
    ).toHaveLength(0);
    expect(
      (await check(AssignTeamDto, { team: null, userIds: [ids.ana] })).errors,
    ).toHaveLength(0);
    expect(
      (await check(AssignTeamDto, { team: 'Alpha', userIds: [ids.ana] }))
        .errors,
    ).toHaveLength(0);
  });

  it.each([
    [CreateTeamDto, { name: '   ', memberIds: [ids.ana] }, 'name'],
    [CreateTeamDto, { name: 'x'.repeat(121), memberIds: [ids.ana] }, 'name'],
    [CreateTeamDto, { name: 'Alpha', memberIds: [] }, 'memberIds'],
    [
      CreateTeamDto,
      { name: 'Alpha', memberIds: [ids.ana, ids.ana] },
      'memberIds',
    ],
    [CreateTeamDto, { name: 'Alpha', memberIds: ['not-an-id'] }, 'memberIds'],
    [CreateTeamDto, { name: 7, memberIds: [ids.ana] }, 'name'],
    [RenameTeamDto, { name: 'Alpha', newName: ' ' }, 'newName'],
    [RenameTeamDto, { newName: 'Beta' }, 'name'],
    [AssignTeamDto, { userIds: [ids.ana] }, 'team'],
    [AssignTeamDto, { team: '', userIds: [ids.ana] }, 'team'],
    [AssignTeamDto, { team: 'Alpha', userIds: [] }, 'userIds'],
  ] as const)('refuses %p %j', async (dto, raw, field) => {
    const { errors } = await check(
      dto as new () => object,
      raw as Record<string, unknown>,
    );
    expect(errors.map((error) => error.property)).toContain(field);
  });

  it('turns a blank member-form team into no team, and normalises a named one', () => {
    expect(plainToInstance(UpdateUserDto, { team: '   ' }).team).toBeNull();
    expect(
      plainToInstance(UpdateUserDto, { team: ' North   Team ' }).team,
    ).toBe('North Team');
  });
});

describe('TeamsController (Teams v1)', () => {
  it('is Super Admin only, on the class, so no route can forget it', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TeamsController)).toEqual([
      UserRole.SUPERADMIN,
    ]);
  });

  it('reads, creates, renames and assigns — nothing deletes an account or a lead', () => {
    const proto = TeamsController.prototype as unknown as Record<
      string,
      object
    >;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map(
        (name) =>
          Reflect.getMetadata(METHOD_METADATA, proto[name]) as RequestMethod,
      );
    expect(methods).toEqual([
      RequestMethod.GET,
      RequestMethod.POST,
      RequestMethod.POST,
      RequestMethod.POST,
    ]);
  });
});
