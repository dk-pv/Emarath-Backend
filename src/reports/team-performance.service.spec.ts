import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { ROLES_KEY } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TeamPerformanceService } from './team-performance.service';
import { TeamPerformanceController } from './team-performance.controller';
import { TeamPerformanceQueryDto } from './dto/team-performance.dto';

const ANA = '00000000-0000-4000-8000-000000000001';
const BEN = '00000000-0000-4000-8000-000000000002';
const CY = '00000000-0000-4000-8000-000000000003';
const ZED = '00000000-0000-4000-8000-000000000004';
const MGR = '00000000-0000-4000-8000-000000000005';
const ADMIN = '00000000-0000-4000-8000-00000000000a';

const dec = (value: string) => new Prisma.Decimal(value);

/** What one lead set holds, as the four reads over it return it. */
interface LeadSet {
  leads: number;
  won: number;
  orders: number;
  wonValue: string;
}

interface Account {
  id: string;
  name: string;
  team: string | null;
  monthlyGoalAmount: Prisma.Decimal | null;
}

interface Options {
  user?: CurrentUser;
  /** The whole filtered set. */
  total?: LeadSet;
  /** Each team's own leads, keyed by team (`'null'` for no team). */
  teams?: Record<string, LeadSet>;
  /** Per-owner counts, as the assignment groupBys return them. */
  owned?: Record<string, number>;
  wonBy?: Record<string, number>;
  ordersBy?: Record<string, number>;
  /** The won assignments the service sums per owner. */
  wonRows?: { userId: string; amount: string | null }[];
  /** Active lead-handling team members (zero rows for those without leads). */
  members?: string[];
  accounts?: Account[];
  /** Per team: active members and the Σ of their goals. */
  teamGroups?: { team: string; members: number; goal: string | null }[];
  manager?: { team: string | null } | null;
}

const set = (leads: number, won = 0, orders = 0, wonValue = '0'): LeadSet => ({
  leads,
  won,
  orders,
  wonValue,
});

const json = (value: unknown) => JSON.stringify(value);

/** Which narrowing a stubbed lead `where` carries: a team's own leads, WON, an order. */
function read(where: unknown) {
  const text = json(where);
  const teams = [
    ...text.matchAll(
      /"assignments":\{"some":\{"user":\{"team":("[^"]*"|null)\}\}\}/g,
    ),
  ].map((match) => String(JSON.parse(match[1])));
  return {
    // The team row's own predicate is the last one ANDed on (a manager's scope carries one too).
    team: teams.length ? teams[teams.length - 1] : undefined,
    won: text.includes('"status":"WON"'),
    order: text.includes('"logisticsOrder":{"isNot":null}'),
  };
}

function makeService(options: Options = {}) {
  const {
    user = { id: ADMIN, role: UserRole.SUPERADMIN, team: null },
    total = set(0),
    teams = {},
    owned = {},
    wonBy = {},
    ordersBy = {},
    wonRows = [],
    members = [],
    accounts = [],
    teamGroups = [],
    manager = null,
  } = options;

  const setFor = (where: unknown): LeadSet => {
    const { team } = read(where);
    return team !== undefined && teams[team] ? teams[team] : total;
  };
  const count = jest.fn((args: { where: unknown }) => {
    const lead = setFor(args.where);
    const { won, order } = read(args.where);
    return Promise.resolve(won ? lead.won : order ? lead.orders : lead.leads);
  });
  const aggregate = jest.fn((args: { where: unknown }) =>
    Promise.resolve({
      _sum: { actualAmount: dec(setFor(args.where).wonValue) },
    }),
  );
  const groups = (counts: Record<string, number>) =>
    Object.entries(counts).map(([userId, n]) => ({
      userId,
      _count: { _all: n },
    }));
  const assignmentGroupBy = jest.fn((args: { where: { lead: unknown } }) => {
    const { won, order } = read(args.where.lead);
    return Promise.resolve(groups(won ? wonBy : order ? ordersBy : owned));
  });
  const userFindMany = jest.fn((args: { where: { id?: { in: string[] } } }) =>
    Promise.resolve(
      args.where.id
        ? accounts.filter((account) => args.where.id?.in.includes(account.id))
        : members.map((id) => ({ id })),
    ),
  );
  const userGroupBy = jest.fn(() =>
    Promise.resolve(
      teamGroups.map((group) => ({
        team: group.team,
        _count: { _all: group.members },
        _sum: { monthlyGoalAmount: group.goal ? dec(group.goal) : null },
      })),
    ),
  );

  const prisma = {
    lead: { count, aggregate },
    leadAssignment: {
      groupBy: assignmentGroupBy,
      findMany: jest.fn().mockResolvedValue(
        wonRows.map((row) => ({
          userId: row.userId,
          lead: { actualAmount: row.amount ? dec(row.amount) : null },
        })),
      ),
    },
    user: {
      findMany: userFindMany,
      findFirst: jest.fn().mockResolvedValue(manager),
      findUnique: jest.fn().mockResolvedValue({
        id: user.id,
        name: 'Self',
        team: user.team ?? null,
      }),
      groupBy: userGroupBy,
    },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue(user),
  } as unknown as CurrentUserService;

  return {
    service: new TeamPerformanceService(prisma, currentUser),
    count,
    aggregate,
    userFindMany,
    userGroupBy,
  };
}

const query = (
  over: Partial<TeamPerformanceQueryDto> = {},
): TeamPerformanceQueryDto =>
  Object.assign(new TeamPerformanceQueryDto(), over);

const account = (
  id: string,
  name: string,
  team: string | null,
  goal: string | null = null,
): Account => ({
  id,
  name,
  team,
  monthlyGoalAmount: goal ? dec(goal) : null,
});

/*
  The org-wide picture the counting rules are read against: Ana and Cy in Alpha share one lead
  (owner rows 7 + 4, Alpha 10), Ben has no team, Zed is in Alpha with nothing yet.
*/
const ORG: Options = {
  total: set(14, 4, 5, '6000'),
  teams: { Alpha: set(10, 3, 4, '4000'), null: set(5, 1, 1, '2000') },
  owned: { [ANA]: 7, [CY]: 4, [BEN]: 5 },
  wonBy: { [ANA]: 2, [CY]: 2, [BEN]: 1 },
  ordersBy: { [ANA]: 3, [CY]: 2, [BEN]: 1 },
  wonRows: [
    { userId: ANA, amount: '1500' },
    { userId: ANA, amount: '1000' },
    { userId: CY, amount: '1000' },
    { userId: CY, amount: '1500' },
    { userId: BEN, amount: '2000' },
  ],
  members: [ANA, CY, ZED],
  accounts: [
    account(ANA, 'Ana', 'Alpha', '5000'),
    account(CY, 'Cy', 'Alpha'),
    account(BEN, 'Ben', null, '1000'),
    account(ZED, 'Zed', 'Alpha', '0'),
  ],
  teamGroups: [{ team: 'Alpha', members: 3, goal: '8000' }],
};

describe('TeamPerformanceService.report — the counting rules', () => {
  it('compares BDEs on their own leads, a shared lead counting for each owner, with zeros for a member with none', async () => {
    const { service } = makeService(ORG);

    const { people } = await service.report(query());

    expect(people).toEqual([
      {
        userId: ANA,
        name: 'Ana',
        team: 'Alpha',
        leads: 7,
        won: 2,
        orders: 3,
        conversionRate: 28.57,
        wonValue: '2500',
        target: '5000',
        achievement: 50,
      },
      expect.objectContaining({
        name: 'Ben',
        leads: 5,
        won: 1,
        achievement: 200,
      }),
      expect.objectContaining({
        name: 'Cy',
        leads: 4,
        conversionRate: 50,
        target: null,
        achievement: null,
      }),
      // In Alpha, active, nothing assigned: shown, not dropped. A zero goal is no target.
      expect.objectContaining({
        name: 'Zed',
        leads: 0,
        won: 0,
        orders: 0,
        conversionRate: 0,
        wonValue: '0',
        target: '0',
        achievement: null,
      }),
    ]);
  });

  it('counts a lead two members of a team share once for the team — 10 leads, not 7 + 4 — and the no-team row last', async () => {
    const { service, count } = makeService(ORG);

    const { teams } = await service.report(query());

    expect(teams).toEqual([
      {
        team: 'Alpha',
        leads: 10,
        won: 3,
        orders: 4,
        conversionRate: 30,
        wonValue: '4000',
        members: 3,
        target: '8000',
        achievement: 50,
      },
      {
        team: null,
        leads: 5,
        won: 1,
        orders: 1,
        conversionRate: 20,
        wonValue: '2000',
        members: null,
        target: null,
        achievement: null,
      },
    ]);
    const alphaLeads = json({
      assignments: { some: { user: { team: 'Alpha' } } },
    });
    expect(
      (count.mock.calls as [{ where: unknown }][]).some(([args]) =>
        json(args.where).includes(alphaLeads),
      ),
    ).toBe(true);
  });

  it('totals the filtered set once — never the sum of the rows', async () => {
    const { service } = makeService(ORG);

    const { total } = await service.report(query());

    expect(total).toEqual({
      leads: 14,
      won: 4,
      orders: 5,
      conversionRate: 28.57,
      wonValue: '6000',
    });
  });

  it('is all zeros, not an error, when nothing matches', async () => {
    const { service } = makeService();

    const result = await service.report(query());

    expect(result).toEqual({
      teams: [],
      people: [],
      total: { leads: 0, won: 0, orders: 0, conversionRate: 0, wonValue: '0' },
    });
  });
});

describe('TeamPerformanceService.report — filters', () => {
  it('threads the window, source, BDE and team into one scoped query', async () => {
    const { service, count } = makeService(ORG);

    await service.report(
      query({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
        source: ['Facebook'],
        agent: [ANA],
        team: ['Alpha'],
      }),
    );

    const first = json(
      (count.mock.calls as [{ where: unknown }][])[0][0].where,
    );
    expect(first).toContain('"gte":"2026-10-01T00:00:00.000Z"');
    expect(first).toContain('"lt":"2026-11-01T00:00:00.000Z"');
    expect(first).toContain('"Facebook"');
    expect(first).toContain(ANA);
    expect(first).toContain('{"team":{"in":["Alpha"]}}');
  });

  it('reads the window off the last status change when asked', async () => {
    const { service, count } = makeService(ORG);

    await service.report(
      query({ from: '2026-10-01T00:00:00.000Z', dateField: 'statusChanged' }),
    );

    const first = json(
      (count.mock.calls as [{ where: unknown }][])[0][0].where,
    );
    expect(first).toContain(
      '"statusChangedAt":{"gte":"2026-10-01T00:00:00.000Z"}',
    );
    expect(first).not.toContain('"createdAt"');
  });

  it('shows only the chosen BDEs, a chosen one with nothing included', async () => {
    const { service } = makeService(ORG);

    const { people } = await service.report(query({ agent: [CY, ZED] }));

    expect(people.map((person) => person.name)).toEqual(['Cy', 'Zed']);
  });

  it('shows only the teams filtered to, and their members', async () => {
    const { service } = makeService({ ...ORG, teams: { Alpha: set(10) } });

    const { teams, people } = await service.report(query({ team: ['Alpha'] }));

    expect(teams.map((team) => team.team)).toEqual(['Alpha']);
    expect(people.map((person) => person.name)).toEqual(['Ana', 'Cy', 'Zed']);
  });

  it('narrows to a Sales Manager’s team when an admin picks the manager', async () => {
    const { service, count } = makeService({
      ...ORG,
      manager: { team: 'Alpha' },
    });

    const { teams } = await service.report(query({ manager: MGR }));

    expect(teams.map((team) => team.team)).toEqual(['Alpha']);
    expect(
      json((count.mock.calls as [{ where: unknown }][])[0][0].where),
    ).toContain('{"team":{"in":["Alpha"]}}');
  });

  it('is empty when the manager’s team is not among the teams asked for', async () => {
    const { service, count } = makeService({
      ...ORG,
      manager: { team: 'Alpha' },
    });

    const result = await service.report(
      query({ manager: MGR, team: ['Bravo'] }),
    );

    expect(result.teams).toEqual([]);
    expect(result.people).toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  it.each([
    [null, /does not exist/],
    [{ team: null }, /has no team/],
  ])('refuses a manager that is %j', async (manager, message) => {
    const { service } = makeService({ ...ORG, manager });

    await expect(service.report(query({ manager: MGR }))).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.report(query({ manager: MGR }))).rejects.toThrow(
      message,
    );
  });
});

describe('TeamPerformanceService.report — who sees what', () => {
  it('shows a sales agent only their own row, within their own leads, and no team', async () => {
    const { service, count, userGroupBy, userFindMany } = makeService({
      ...ORG,
      user: { id: ANA, role: UserRole.SALES_AGENT, team: 'Alpha' },
    });

    const { teams, people } = await service.report(query({ team: ['Bravo'] }));

    expect(teams).toEqual([]);
    expect(people.map((person) => person.name)).toEqual(['Ana']);
    expect(userGroupBy).not.toHaveBeenCalled();
    const accountsAsked = (
      userFindMany.mock.calls as [{ where: { id?: { in: string[] } } }][]
    ).find(([args]) => args.where.id)?.[0].where.id?.in;
    expect(accountsAsked).toEqual([ANA]);
    // Their lead scope, not the team they asked for.
    const first = json(
      (count.mock.calls as [{ where: unknown }][])[0][0].where,
    );
    expect(first).toContain(`"assignments":{"some":{"userId":"${ANA}"}}`);
    expect(first).not.toContain('Bravo');
  });

  it('shows a Sales Manager their own team only, whatever team they ask for', async () => {
    const manager: CurrentUser = {
      id: MGR,
      role: UserRole.SALES_MANAGER,
      team: 'Alpha',
    };
    const { service, count } = makeService({ ...ORG, user: manager });

    const own = await service.report(query());
    expect(own.teams.map((team) => team.team)).toEqual(['Alpha']);
    expect(own.people.every((person) => person.team === 'Alpha')).toBe(true);

    count.mockClear();
    const other = await service.report(query({ team: ['Bravo'] }));
    expect(other.teams).toEqual([]);
    expect(other.people).toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  it('shows a Sales Manager with no team only their own row', async () => {
    const { service } = makeService({
      ...ORG,
      owned: { [MGR]: 2 },
      accounts: [account(MGR, 'Mia', null)],
      user: { id: MGR, role: UserRole.SALES_MANAGER, team: null },
    });

    const { teams, people } = await service.report(query());

    expect(teams).toEqual([]);
    expect(people).toEqual([
      expect.objectContaining({ name: 'Mia', leads: 2 }),
    ]);
  });
});

describe('TeamPerformanceService.filterOptions', () => {
  function optionsService(user: CurrentUser) {
    const findMany = jest.fn(
      (args: {
        where: { role?: unknown; team?: unknown };
        distinct?: string[];
      }) =>
        Promise.resolve(
          args.distinct
            ? [{ team: 'Alpha' }, { team: 'Bravo' }]
            : args.where.role === UserRole.SALES_MANAGER
              ? [{ id: MGR, name: 'Mia', team: 'Alpha' }]
              : [{ id: ANA, name: 'Ana', team: 'Alpha' }],
        ),
    );
    const prisma = {
      user: {
        findMany,
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: ANA, name: 'Ana', team: 'Alpha' }),
      },
    } as unknown as PrismaService;
    const currentUser = {
      resolve: jest.fn().mockResolvedValue(user),
    } as unknown as CurrentUserService;
    return {
      service: new TeamPerformanceService(prisma, currentUser),
      findMany,
    };
  }

  it('offers the admin every team, every manager with a team and every BDE', async () => {
    const { service } = optionsService({
      id: ADMIN,
      role: UserRole.SUPERADMIN,
      team: null,
    });

    expect(await service.filterOptions()).toEqual({
      teams: ['Alpha', 'Bravo'],
      managers: [{ id: MGR, name: 'Mia', team: 'Alpha' }],
      agents: [{ id: ANA, name: 'Ana', team: 'Alpha' }],
    });
  });

  it('offers a Sales Manager only their own team and its people, and no manager filter', async () => {
    const { service, findMany } = optionsService({
      id: MGR,
      role: UserRole.SALES_MANAGER,
      team: 'Alpha',
    });

    const options = await service.filterOptions();

    expect(options.managers).toEqual([]);
    const wheres = (
      findMany.mock.calls as [{ where: { team?: unknown } }][]
    ).map(([args]) => args.where.team);
    expect(wheres).toEqual([{ equals: 'Alpha' }, 'Alpha']);
  });

  it('offers a sales agent nothing but themselves', async () => {
    const { service, findMany } = optionsService({
      id: ANA,
      role: UserRole.SALES_AGENT,
      team: 'Alpha',
    });

    expect(await service.filterOptions()).toEqual({
      teams: [],
      managers: [],
      agents: [{ id: ANA, name: 'Ana', team: 'Alpha' }],
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('TeamPerformanceQueryDto', () => {
  const check = async (raw: Record<string, unknown>) => {
    const dto = plainToInstance(TeamPerformanceQueryDto, raw);
    return { dto, errors: await validate(dto) };
  };

  it('accepts the window, repeated filters and a manager', async () => {
    const { dto, errors } = await check({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31',
      team: ['Alpha', 'Bravo'],
      agent: ANA,
      source: 'Facebook',
      manager: MGR,
      dateField: 'statusChanged',
    });
    expect(errors).toHaveLength(0);
    expect(dto.agent).toEqual([ANA]);
    expect(dto.source).toEqual(['Facebook']);
  });

  it.each([
    [{ from: 'yesterday' }, 'from'],
    [{ to: '2026-02-30' }, 'to'],
    [{ agent: 'not-an-id' }, 'agent'],
    [{ manager: 'not-an-id' }, 'manager'],
    [{ dateField: 'updated' }, 'dateField'],
    [{ team: 'x'.repeat(121) }, 'team'],
    [{ source: 'y'.repeat(121) }, 'source'],
  ])('refuses %j', async (raw, field) => {
    const { errors } = await check(raw);
    expect(errors.map((error) => error.property)).toContain(field);
  });
});

describe('TeamPerformanceController', () => {
  it('names no roles, like every report: sales roles reach it, post-sale roles never do', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, TeamPerformanceController),
    ).toBeUndefined();
  });

  it('only reads', () => {
    const proto = TeamPerformanceController.prototype as unknown as Record<
      string,
      object
    >;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map(
        (name) =>
          Reflect.getMetadata(METHOD_METADATA, proto[name]) as RequestMethod,
      );
    expect(methods).toEqual([RequestMethod.GET, RequestMethod.GET]);
  });
});
