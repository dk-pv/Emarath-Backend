import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AssignmentAlgorithm,
  AssignmentApplyTo,
  AssignmentRuleStatus,
  AssignmentTarget,
  UserRole,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AssignmentRulesService } from './assignment-rules.service';
import { LeadAssignmentEngine } from './lead-assignment.engine';
import {
  CreateAssignmentRuleDto,
  DEFAULT_RULE_PAGE_SIZE,
  ListAssignmentRulesQueryDto,
  UpdateAssignmentRuleDto,
} from './dto/assignment-rule.dto';
import { ASSIGNMENT_GENERAL_DEFAULTS } from '../settings/dto/assignment-general.dto';

const ACTOR = '11111111-1111-1111-1111-111111111111';
const ID = '22222222-2222-2222-2222-222222222222';

const storedRule = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Round robin everyone',
  description: 'Everything to everyone',
  algorithm: AssignmentAlgorithm.ROUND_ROBIN,
  status: AssignmentRuleStatus.ACTIVE,
  createdAt: new Date('2026-09-05T10:00:00.000Z'),
  updatedAt: new Date('2026-09-05T10:00:00.000Z'),
  createdBy: { name: 'Emarath Admin' },
  groups: [
    {
      id: 'g1',
      name: 'New Rule',
      position: 0,
      applyTo: AssignmentApplyTo.ALL_RECORDS,
      target: AssignmentTarget.ALL_USERS,
    },
  ],
  ...over,
});

function makeService() {
  const findMany = jest.fn().mockResolvedValue([storedRule()]);
  const count = jest.fn().mockResolvedValue(1);
  const create = jest.fn().mockResolvedValue(storedRule());
  const update = jest.fn().mockResolvedValue(storedRule());
  /*
    Three different queries share findFirst: the duplicate-name check (filters on name),
    the existence check and byId (filter on id). One blanket return value cannot serve all
    three — a row would read as a name clash — so the mock answers by what it was asked.
  */
  let nameClash = false;
  const findFirst = jest.fn((args: { where: Record<string, unknown> }) =>
    Promise.resolve(
      args.where.name !== undefined
        ? nameClash
          ? { id: 'other' }
          : null
        : ruleExists
          ? storedRule()
          : null,
    ),
  );
  let ruleExists = true;
  const groupDeleteMany = jest.fn().mockResolvedValue({ count: 1 });

  const tx = {
    assignmentRule: { update },
    assignmentRuleGroup: { deleteMany: groupDeleteMany },
  };

  const prisma = {
    assignmentRule: { findMany, count, create, update, findFirst },
    assignmentRuleGroup: { deleteMany: groupDeleteMany },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as PrismaService;

  return {
    service: new AssignmentRulesService(prisma),
    findMany,
    count,
    create,
    update,
    findFirst,
    groupDeleteMany,
    setNameClash: (value: boolean) => {
      nameClash = value;
    },
    setRuleExists: (value: boolean) => {
      ruleExists = value;
    },
  };
}

const listArgs = (findMany: jest.Mock) =>
  (
    findMany.mock.calls[0] as [
      { where: Record<string, unknown>; skip: number; take: number },
    ]
  )[0];

const dto = (
  over: Partial<CreateAssignmentRuleDto> = {},
): CreateAssignmentRuleDto => ({
  name: 'Round robin everyone',
  description: 'Everything to everyone',
  algorithm: AssignmentAlgorithm.ROUND_ROBIN,
  status: AssignmentRuleStatus.ACTIVE,
  groups: [
    {
      name: 'New Rule',
      applyTo: AssignmentApplyTo.ALL_RECORDS,
      target: AssignmentTarget.ALL_USERS,
    },
  ],
  ...over,
});

describe('AssignmentRulesService — list', () => {
  const query = (
    over: Partial<ListAssignmentRulesQueryDto> = {},
  ): ListAssignmentRulesQueryDto => ({ ...over });

  it('returns the page, the total and each rule with its groups in order', async () => {
    const { service } = makeService();

    const result = await service.list(query());

    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      id: ID,
      name: 'Round robin everyone',
      algorithm: 'ROUND_ROBIN',
      status: 'ACTIVE',
      createdByName: 'Emarath Admin',
    });
    expect(result.rows[0].groups).toEqual([
      {
        id: 'g1',
        name: 'New Rule',
        position: 0,
        applyTo: 'ALL_RECORDS',
        target: 'ALL_USERS',
      },
    ]);
  });

  it('never returns soft-deleted rules', async () => {
    const { service, findMany } = makeService();
    await service.list(query());
    expect(listArgs(findMany).where).toMatchObject({ deletedAt: null });
  });

  it('opens on the reference page size', async () => {
    const { service, findMany } = makeService();
    await service.list(query());
    expect(listArgs(findMany).take).toBe(DEFAULT_RULE_PAGE_SIZE);
  });

  it('pages in the query, not in the client', async () => {
    const { service, findMany } = makeService();
    await service.list(query({ page: 3, size: 10 }));
    expect(listArgs(findMany).skip).toBe(20);
    expect(listArgs(findMany).take).toBe(10);
  });

  it('filters by each status the reference offers', async () => {
    const active = makeService();
    await active.service.list(query({ status: AssignmentRuleStatus.ACTIVE }));
    expect(listArgs(active.findMany).where).toMatchObject({ status: 'ACTIVE' });

    const inactive = makeService();
    await inactive.service.list(
      query({ status: AssignmentRuleStatus.INACTIVE }),
    );
    expect(listArgs(inactive.findMany).where).toMatchObject({
      status: 'INACTIVE',
    });

    const all = makeService();
    await all.service.list(query());
    expect(listArgs(all.findMany).where).not.toHaveProperty('status');
  });

  it('searches the rule name, case-insensitively, in the query', async () => {
    const { service, findMany } = makeService();
    await service.list(query({ search: 'robin' }));
    expect(listArgs(findMany).where).toMatchObject({
      name: { contains: 'robin', mode: 'insensitive' },
    });
  });

  it('combines search and status into one query', async () => {
    const { service, findMany } = makeService();
    await service.list(
      query({ search: 'robin', status: AssignmentRuleStatus.INACTIVE }),
    );
    expect(listArgs(findMany).where).toMatchObject({
      deletedAt: null,
      status: 'INACTIVE',
      name: { contains: 'robin', mode: 'insensitive' },
    });
  });

  it('counts against the same predicate it lists with', async () => {
    const { service, findMany, count } = makeService();
    await service.list(query({ search: 'robin' }));
    const counted = (count.mock.calls[0] as [{ where: unknown }])[0].where;
    expect(counted).toEqual(listArgs(findMany).where);
  });
});

describe('AssignmentRulesService — create, update, delete', () => {
  it('stamps the author from the session and stores the groups in order', async () => {
    const { service, create } = makeService();

    await service.create(
      dto({
        groups: [
          {
            name: 'First',
            applyTo: AssignmentApplyTo.ALL_RECORDS,
            target: AssignmentTarget.ALL_USERS,
          },
          {
            name: 'Second',
            applyTo: AssignmentApplyTo.ALL_RECORDS,
            target: AssignmentTarget.ALL_USERS,
          },
        ],
      }),
      ACTOR,
    );

    const args = (
      create.mock.calls[0] as [
        {
          data: {
            createdById: string;
            groups: { create: { name: string; position: number }[] };
          };
        },
      ]
    )[0];
    expect(args.data.createdById).toBe(ACTOR);
    expect(args.data.groups.create).toEqual([
      expect.objectContaining({ name: 'First', position: 0 }),
      expect.objectContaining({ name: 'Second', position: 1 }),
    ]);
  });

  it('refuses a duplicate rule name, whatever its casing', async () => {
    const { service, findFirst, setNameClash } = makeService();
    setNameClash(true);

    await expect(service.create(dto(), ACTOR)).rejects.toThrow(
      ConflictException,
    );

    const args = (findFirst.mock.calls[0] as [{ where: { name: unknown } }])[0];
    expect(args.where.name).toMatchObject({ mode: 'insensitive' });
  });

  it('edits the rule in place rather than creating a second one', async () => {
    const { service, update, create } = makeService();

    await service.update(ID, { name: 'Renamed' });

    expect(create).not.toHaveBeenCalled();
    const args = (
      update.mock.calls[0] as [
        { where: { id: string }; data: Record<string, unknown> },
      ]
    )[0];
    expect(args.where.id).toBe(ID);
    expect(args.data).toEqual({ name: 'Renamed' });
  });

  it('replaces the whole group list when groups are sent, in one transaction', async () => {
    const { service, update, groupDeleteMany } = makeService();

    await service.update(ID, {
      groups: [
        {
          name: 'Only',
          applyTo: AssignmentApplyTo.ALL_RECORDS,
          target: AssignmentTarget.ALL_USERS,
        },
      ],
    });

    expect(groupDeleteMany).toHaveBeenCalledWith({ where: { ruleId: ID } });
    const args = (
      update.mock.calls[0] as [
        { data: { groups?: { create: { position: number }[] } } },
      ]
    )[0];
    expect(args.data.groups?.create).toEqual([
      expect.objectContaining({ name: 'Only', position: 0 }),
    ]);
  });

  it('leaves the groups untouched when the edit does not mention them', async () => {
    const { service, groupDeleteMany } = makeService();

    await service.update(ID, { status: AssignmentRuleStatus.INACTIVE });

    expect(groupDeleteMany).not.toHaveBeenCalled();
  });

  it('reorders groups by the order they arrive in', async () => {
    const { service, update } = makeService();

    await service.update(ID, {
      groups: [
        {
          name: 'B',
          applyTo: AssignmentApplyTo.ALL_RECORDS,
          target: AssignmentTarget.ALL_USERS,
        },
        {
          name: 'A',
          applyTo: AssignmentApplyTo.ALL_RECORDS,
          target: AssignmentTarget.ALL_USERS,
        },
      ],
    });

    const args = (
      update.mock.calls[0] as [
        { data: { groups?: { create: { name: string; position: number }[] } } },
      ]
    )[0];
    expect(args.data.groups?.create).toEqual([
      expect.objectContaining({ name: 'B', position: 0 }),
      expect.objectContaining({ name: 'A', position: 1 }),
    ]);
  });

  it('refuses to edit or delete a rule that is gone', async () => {
    const { service, update, setRuleExists } = makeService();
    setRuleExists(false);

    await expect(service.update(ID, { name: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(ID)).rejects.toThrow(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('deletes softly, leaving the record in place', async () => {
    const { service, update } = makeService();

    await expect(service.remove(ID)).resolves.toEqual({ id: ID });
    const args = (update.mock.calls[0] as [{ data: { deletedAt: Date } }])[0];
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------------------

function makeEngine(
  over: {
    settings?: Partial<typeof ASSIGNMENT_GENERAL_DEFAULTS>;
    rule?: unknown;
    users?: unknown[];
  } = {},
) {
  const ruleFindFirst = jest.fn().mockResolvedValue(
    over.rule === undefined
      ? {
          id: ID,
          groups: [
            {
              applyTo: AssignmentApplyTo.ALL_RECORDS,
              target: AssignmentTarget.ALL_USERS,
            },
          ],
        }
      : over.rule,
  );
  const userFindMany = jest.fn().mockResolvedValue(over.users ?? []);

  const prisma = {
    assignmentRule: { findFirst: ruleFindFirst },
    user: { findMany: userFindMany },
  } as unknown as PrismaService;

  const getAssignmentGeneral = jest.fn().mockResolvedValue({
    ...ASSIGNMENT_GENERAL_DEFAULTS,
    ...over.settings,
  });
  const settings = { getAssignmentGeneral } as unknown as SettingsService;

  return {
    engine: new LeadAssignmentEngine(prisma, settings),
    ruleFindFirst,
    userFindMany,
    getAssignmentGeneral,
  };
}

const agent = (id: string, name: string, lastAssignedAt: string | null) => ({
  id,
  name,
  assignments: lastAssignedAt ? [{ createdAt: new Date(lastAssignedAt) }] : [],
});

describe('LeadAssignmentEngine', () => {
  it('assigns nobody while automatic assigning is off', async () => {
    const { engine, ruleFindFirst } = makeEngine({
      settings: { automaticLeadAssigning: false },
    });

    await expect(engine.pickAssignee()).resolves.toBeNull();
    // It does not even look for a rule — the switch is the first gate.
    expect(ruleFindFirst).not.toHaveBeenCalled();
  });

  it('assigns nobody when no active rule exists', async () => {
    const { engine, userFindMany } = makeEngine({ rule: null });

    await expect(engine.pickAssignee()).resolves.toBeNull();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('only reads rules that are active and not deleted', async () => {
    const { engine, ruleFindFirst } = makeEngine({
      users: [agent('a', 'Ana', null)],
    });

    await engine.pickAssignee();

    const args = (
      ruleFindFirst.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0];
    expect(args.where).toEqual({ deletedAt: null, status: 'ACTIVE' });
  });

  it('assigns nobody when the active rule has no group that applies', async () => {
    const { engine, userFindMany } = makeEngine({
      rule: { id: ID, groups: [] },
    });

    await expect(engine.pickAssignee()).resolves.toBeNull();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('gives the lead to an agent who has never been assigned one', async () => {
    const { engine } = makeEngine({
      users: [
        agent('a', 'Ana', '2026-09-01T10:00:00.000Z'),
        agent('b', 'Ben', null),
        agent('c', 'Cara', '2026-09-02T10:00:00.000Z'),
      ],
    });

    await expect(engine.pickAssignee()).resolves.toBe('b');
  });

  it('otherwise rotates to whoever was assigned longest ago', async () => {
    const { engine } = makeEngine({
      users: [
        agent('a', 'Ana', '2026-09-03T10:00:00.000Z'),
        agent('b', 'Ben', '2026-09-01T10:00:00.000Z'),
        agent('c', 'Cara', '2026-09-02T10:00:00.000Z'),
      ],
    });

    await expect(engine.pickAssignee()).resolves.toBe('b');
  });

  it('never considers inactive, deleted or non-assignable accounts', async () => {
    const { engine, userFindMany } = makeEngine({
      users: [agent('a', 'Ana', null)],
    });

    await engine.pickAssignee();

    const args = (
      userFindMany.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0];
    expect(args.where).toMatchObject({ deletedAt: null, isActive: true });
    expect(args.where.role).toEqual({
      in: [
        UserRole.SALES_AGENT,
        UserRole.SALES_MANAGER,
        UserRole.CUSTOMER_SERVICE_AGENT,
      ],
    });
    // The login check is off by default, so it must not narrow the candidates.
    expect(args.where).not.toHaveProperty('lastLoginAt');
  });

  it('excludes accounts that never signed in when the setting asks', async () => {
    const { engine, userFindMany } = makeEngine({
      settings: { checkUserLoggedInBeforeAssigning: true },
      users: [agent('a', 'Ana', null)],
    });

    await engine.pickAssignee();

    const args = (
      userFindMany.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0];
    expect(args.where.lastLoginAt).toEqual({ not: null });
  });

  it('assigns nobody when no agent is eligible', async () => {
    const { engine } = makeEngine({ users: [] });
    await expect(engine.pickAssignee()).resolves.toBeNull();
  });

  it('never lets a configuration failure block the lead', async () => {
    const { engine, getAssignmentGeneral } = makeEngine();
    getAssignmentGeneral.mockRejectedValue(new Error('settings unreachable'));

    await expect(engine.pickAssignee()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------

describe('CreateAssignmentRuleDto validation', () => {
  const messages = async (
    over: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const instance = plainToInstance(CreateAssignmentRuleDto, {
      name: 'Round robin everyone',
      description: 'Everything to everyone',
      algorithm: 'ROUND_ROBIN',
      status: 'ACTIVE',
      groups: [
        { name: 'New Rule', applyTo: 'ALL_RECORDS', target: 'ALL_USERS' },
      ],
      ...over,
    });
    const errors = await validate(instance);
    const flatten = (list: typeof errors): string[] =>
      list.flatMap((error) => [
        ...Object.values(error.constraints ?? {}),
        ...flatten(error.children ?? []),
      ]);
    return flatten(errors);
  };

  it('accepts a complete rule', async () => {
    expect(await messages()).toEqual([]);
  });

  it('requires a rule name', async () => {
    expect((await messages({ name: '' })).length).toBeGreaterThan(0);
    expect((await messages({ name: '   ' })).length).toBeGreaterThan(0);
  });

  it('leaves the description optional, as the reference does', async () => {
    expect(await messages({ description: '' })).toEqual([]);
  });

  it('requires at least one configuration group', async () => {
    const errors = await messages({ groups: [] });
    expect(errors.join(' ')).toContain('at least one configuration group');
  });

  it('validates each group, not just the array', async () => {
    const errors = await messages({
      groups: [{ name: '', applyTo: 'ALL_RECORDS', target: 'ALL_USERS' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts only the vocabulary the reference offers', async () => {
    expect((await messages({ algorithm: 'WEIGHTED' })).length).toBeGreaterThan(
      0,
    );
    expect((await messages({ status: 'ARCHIVED' })).length).toBeGreaterThan(0);
    expect(
      (
        await messages({
          groups: [{ name: 'x', applyTo: 'NEW_RECORDS', target: 'ALL_USERS' }],
        })
      ).length,
    ).toBeGreaterThan(0);
  });

  it('trims the rule name', () => {
    const instance = plainToInstance(CreateAssignmentRuleDto, {
      name: '  Spaced  ',
      description: '',
      algorithm: 'ROUND_ROBIN',
      status: 'ACTIVE',
      groups: [],
    });
    expect(instance.name).toBe('Spaced');
  });
});

describe('UpdateAssignmentRuleDto validation', () => {
  const messages = async (raw: Record<string, unknown>): Promise<string[]> => {
    const instance = plainToInstance(UpdateAssignmentRuleDto, raw);
    const errors = await validate(instance);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts a partial edit', async () => {
    expect(await messages({ name: 'Renamed' })).toEqual([]);
    expect(await messages({ status: 'INACTIVE' })).toEqual([]);
    expect(await messages({})).toEqual([]);
  });

  it('applies the same rules to whatever it does send', async () => {
    expect((await messages({ name: '  ' })).length).toBeGreaterThan(0);
    expect((await messages({ status: 'ARCHIVED' })).length).toBeGreaterThan(0);
    expect((await messages({ groups: [] })).length).toBeGreaterThan(0);
  });
});

describe('ListAssignmentRulesQueryDto validation', () => {
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(ListAssignmentRulesQueryDto, raw);

  it('coerces the numeric query parameters', () => {
    const parsed = parse({ page: '2', size: '50' });
    expect(parsed.page).toBe(2);
    expect(parsed.size).toBe(50);
  });

  it('treats an empty search as no search', () => {
    expect(parse({ search: '   ' }).search).toBeUndefined();
  });

  it('rejects a status the filter does not offer', async () => {
    expect((await validate(parse({ status: 'ARCHIVED' }))).length).toBe(1);
    expect((await validate(parse({ status: 'ACTIVE' }))).length).toBe(0);
  });

  it('caps the page size', async () => {
    expect((await validate(parse({ size: '5000' }))).length).toBeGreaterThan(0);
  });
});
