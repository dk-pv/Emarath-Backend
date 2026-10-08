import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivityType, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ActivitiesService } from './activities.service';
import { activityScopeWhere } from './activity-scope';
import { CreateActivityDto } from './dto/create-activity.dto';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const ACT_ID = '33333333-3333-3333-3333-333333333333';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const DUE = '2026-08-01T09:00:00.000Z';

/** A row shaped like ACTIVITY_SELECT — enough for toActivityItem to run. */
function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACT_ID,
    type: ActivityType.CALL,
    leadId: LEAD_ID,
    description: 'call them',
    dueAt: new Date(DUE),
    endAt: null,
    completedAt: null,
    assignees: [{ userId: AGENT_ID }],
    ...overrides,
  };
}

function makeDto(
  overrides: Partial<CreateActivityDto> = {},
): CreateActivityDto {
  return {
    type: ActivityType.CALL,
    leadId: LEAD_ID,
    description: 'call them',
    dueAt: DUE,
    assigneeIds: [AGENT_ID],
    ...overrides,
  };
}

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const leadFindFirst = jest.fn();
  const activityCreate = jest.fn();
  const activityFindMany = jest.fn();
  const activityCount = jest.fn();
  const activityFindFirst = jest.fn();
  const activityUpdate = jest.fn();
  // Assignee access (ADR-0086): every id resolves to a live user who can open the lead,
  // unless a test says otherwise.
  const userFindMany = jest.fn((args: { where: { id: { in: string[] } } }) =>
    Promise.resolve(
      args.where.id.in.map((id) => ({
        id,
        name: `User ${id}`,
        role: UserRole.SALES_AGENT,
        team: null,
      })),
    ),
  );
  const leadCount = jest.fn().mockResolvedValue(1);
  // $transaction runs the ops array and resolves to the ops' return values —
  // exactly what the real client does, so the mocked findMany/count values flow
  // straight through.
  const $transaction = jest.fn((ops: unknown[]) => Promise.resolve(ops));

  const prisma = {
    lead: { findFirst: leadFindFirst, count: leadCount },
    user: { findMany: userFindMany },
    activity: {
      create: activityCreate,
      findMany: activityFindMany,
      count: activityCount,
      findFirst: activityFindFirst,
      update: activityUpdate,
    },
    $transaction,
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;

  // Settings → Activity and Reminders supplies the overdue rule; the shipped end-of-day
  // rule keeps these expectations reading exactly as they did before it was configurable.
  const getActivityGeneral = jest.fn().mockResolvedValue({
    autoPromptFollowUpOnCompletion: true,
    followUpMandatoryOnStatusChange: true,
    remindersEnabled: true,
    reminderTime: 'AT_TIME_OF_EVENT',
    overdueMode: 'END_OF_DAY',
    overdueAfterMinutes: 15,
  });
  const settings = { getActivityGeneral } as unknown as SettingsService;

  const service = new ActivitiesService(prisma, currentUser, settings);
  return {
    service,
    leadFindFirst,
    activityCreate,
    activityFindMany,
    getActivityGeneral,
    activityCount,
    activityFindFirst,
    activityUpdate,
    userFindMany,
    leadCount,
  };
}

/** A row shaped like LEAD_LIST_SELECT — enough for toLeadListItem to run. */
function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    name: 'Acme',
    firstName: null,
    primaryPhone: '900',
    secondaryPhone: null,
    language: null,
    country: null,
    source: null,
    status: 'New',
    pipeline: 'Lead Pipeline',
    category: null,
    actualAmount: null,
    forecastedAmount: null,
    bookingDate: null,
    callStatus: null,
    callAttempts: 0,
    whatsappAttempts: 0,
    createdAt: new Date('2026-07-21T00:00:00.000Z'),
    updatedAt: new Date('2026-07-21T00:00:00.000Z'),
    assignments: [],
    tags: [],
    product: null,
    productQty: null,
    product2: null,
    product2Qty: null,
    paymentMethod: null,
    nationalCode: null,
    complaints: [],
    customFieldValues: [],
    _count: { activities: 0, calls: 0 },
    ...overrides,
  };
}

/** A row shaped like ACTIVITY_LIST_SELECT — enough for toActivityListItem. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACT_ID,
    type: ActivityType.CALL,
    dueAt: new Date(DUE),
    endAt: null,
    completedAt: null,
    assignees: [{ user: { id: AGENT_ID, name: 'Agent Two' } }],
    lead: leadRow(),
    ...overrides,
  };
}

const BOUNDS = {
  todayStart: '2026-07-24T00:00:00.000Z',
  todayEnd: '2026-07-25T00:00:00.000Z',
  tomorrowEnd: '2026-07-26T00:00:00.000Z',
};

describe('ActivitiesService.create', () => {
  it('creates a follow-up and derives the title from type + lead name', async () => {
    const { service, leadFindFirst, activityCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    activityCreate.mockResolvedValue(activityRow());

    const item = await service.create(makeDto());

    expect(item.title).toBe('Call with Acme');
    expect(item.assigneeIds).toEqual([AGENT_ID]);
    const data = (activityCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data.lead).toEqual({ connect: { id: LEAD_ID } });
    expect(data.data.dueAt).toEqual(new Date(DUE));
    expect(data.data.endAt).toBeNull();
    expect(data.data.assignees).toEqual({
      create: [{ user: { connect: { id: AGENT_ID } } }],
    });
  });

  it('accepts an End Time on a Meeting', async () => {
    const { service, leadFindFirst, activityCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    activityCreate.mockResolvedValue(
      activityRow({ type: ActivityType.MEETING }),
    );
    const end = '2026-08-01T10:00:00.000Z';

    await service.create(makeDto({ type: ActivityType.MEETING, endAt: end }));

    const data = (activityCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data.endAt).toEqual(new Date(end));
  });

  it('rejects an End Time on a Call', async () => {
    const { service, activityCreate } = makeService();
    await expect(
      service.create(makeDto({ endAt: '2026-08-01T10:00:00.000Z' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('rejects an End Time before the Start Time', async () => {
    const { service, activityCreate } = makeService();
    await expect(
      service.create(
        makeDto({
          type: ActivityType.MEETING,
          endAt: '2026-08-01T08:00:00.000Z',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('404s (and never creates) when the lead is outside the caller scope', async () => {
    const { service, leadFindFirst, activityCreate } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(service.create(makeDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('auto-adds a sales agent as an assignee so they can see their own follow-up', async () => {
    const { service, leadFindFirst, activityCreate } = makeService(
      UserRole.SALES_AGENT,
    );
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    activityCreate.mockResolvedValue(activityRow());

    // The agent (u1) assigns only someone else; the service must add u1 too.
    await service.create(makeDto({ assigneeIds: [AGENT_ID] }));

    const data = (activityCreate.mock.calls as unknown[][])[0][0] as {
      data: { assignees: { create: { user: { connect: { id: string } } }[] } };
    };
    const ids = data.data.assignees.create.map((a) => a.user.connect.id);
    expect(ids).toContain('u1');
    expect(ids).toContain(AGENT_ID);
  });

  it('refuses an assignee who cannot open the lead, naming them (ADR-0086)', async () => {
    const { service, leadFindFirst, activityCreate, leadCount } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    leadCount.mockResolvedValue(0);

    await expect(service.create(makeDto())).rejects.toThrow(
      `User ${AGENT_ID} can't be assigned this follow-up: the lead is outside their access.`,
    );
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('checks each assignee against the lead with their own lead scope', async () => {
    const { service, leadFindFirst, activityCreate, leadCount } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    activityCreate.mockResolvedValue(activityRow());

    await service.create(makeDto());

    expect(leadCount).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            deletedAt: null,
            assignments: { some: { userId: AGENT_ID } },
          },
          { id: LEAD_ID },
        ],
      },
    });
  });

  it('refuses an assignee id that is not a live user', async () => {
    const { service, leadFindFirst, activityCreate, userFindMany } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    userFindMany.mockResolvedValue([]);

    await expect(service.create(makeDto())).rejects.toThrow(
      'One or more assignees do not exist.',
    );
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('maps a bad assignee foreign key to a 400', async () => {
    const { service, leadFindFirst, activityCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    activityCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(service.create(makeDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ActivitiesService.list', () => {
  it('returns lead-joined rows, total and per-bucket counts', async () => {
    const { service, activityFindMany, activityCount } = makeService();
    activityFindMany.mockReturnValue([listRow()]);
    // consumed in order: overdue/today/tomorrow/completed/all.
    activityCount
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(14);

    const res = await service.list({
      bucket: 'all',
      page: 1,
      size: 100,
      ...BOUNDS,
    });

    // The active tab's count is the total — the footer and the badge are one number.
    expect(res.total).toBe(14);
    expect(res.overdueBefore).toBe(BOUNDS.todayStart);
    expect(res.counts).toEqual({
      overdue: 5,
      today: 2,
      tomorrow: 3,
      completed: 4,
      all: 14,
    });
    const row = res.rows[0];
    expect(row.title).toBe('Call with Acme');
    expect(row.lead.id).toBe(LEAD_ID);
    expect(row.assignees).toEqual([{ id: AGENT_ID, name: 'Agent Two' }]);
  });

  it('applies the configured overdue rule to the page and every tab count', async () => {
    const { service, activityFindMany, activityCount, getActivityGeneral } =
      makeService();
    activityFindMany.mockReturnValue([]);
    activityCount.mockReturnValue(0);
    // Settings → Activity and Reminders: overdue 15 minutes after the due time.
    getActivityGeneral.mockResolvedValue({
      autoPromptFollowUpOnCompletion: true,
      followUpMandatoryOnStatusChange: true,
      remindersEnabled: true,
      reminderTime: 'AT_TIME_OF_EVENT',
      overdueMode: 'CUSTOM_TIME_SPAN',
      overdueAfterMinutes: 15,
    });

    const before = Date.now();
    await service.list({ bucket: 'overdue', page: 1, size: 100, ...BOUNDS });

    const args = (activityFindMany.mock.calls as unknown[][])[0][0] as {
      where: { AND: { dueAt?: { lt?: Date } }[] };
    };
    const cutoff = args.where.AND.at(-1)?.dueAt?.lt as Date;

    // Fifteen minutes back from now, not midnight — the shipped rule would be todayStart.
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 15 * 60_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(
      Date.now() - 15 * 60_000 + 5_000,
    );

    // The badge counts read the same instant, so a tab cannot disagree with its count.
    const counted = (activityCount.mock.calls as unknown[][])[0][0] as {
      where: { AND: { dueAt?: { lt?: Date } }[] };
    };
    expect(counted.where.AND.at(-1)?.dueAt?.lt).toEqual(cutoff);
  });

  it('falls back to the end-of-day rule when the settings row cannot be read', async () => {
    const { service, activityFindMany, activityCount, getActivityGeneral } =
      makeService();
    activityFindMany.mockReturnValue([]);
    activityCount.mockReturnValue(0);
    getActivityGeneral.mockRejectedValue(new Error('settings unavailable'));

    await service.list({ bucket: 'overdue', page: 1, size: 100, ...BOUNDS });

    const args = (activityFindMany.mock.calls as unknown[][])[0][0] as {
      where: { AND: { dueAt?: { lt?: Date } }[] };
    };
    expect(args.where.AND.at(-1)?.dueAt?.lt).toEqual(
      new Date(BOUNDS.todayStart),
    );
  });

  it('scopes a sales agent to their own activities', async () => {
    const { service, activityFindMany, activityCount } = makeService(
      UserRole.SALES_AGENT,
    );
    activityFindMany.mockReturnValue([]);
    activityCount.mockReturnValue(0);

    await service.list({ bucket: 'overdue', page: 1, size: 100, ...BOUNDS });

    const args = (activityFindMany.mock.calls as unknown[][])[0][0] as {
      where: { AND: unknown[] };
    };
    expect(args.where.AND[0]).toEqual(
      activityScopeWhere({ id: 'u1', role: UserRole.SALES_AGENT }),
    );
  });

  it('folds search + filters into the page query and the tab counts', async () => {
    const { service, activityFindMany, activityCount } = makeService();
    activityFindMany.mockReturnValue([]);
    activityCount.mockReturnValue(0);

    await service.list({
      bucket: 'all',
      page: 1,
      size: 100,
      search: 'acme',
      assignedAgent: [AGENT_ID],
      status: ['New'],
      ...BOUNDS,
    });

    const page = (activityFindMany.mock.calls as unknown[][])[0][0] as {
      where: { AND: unknown[] };
    };
    // scope, search, assignee filter, status filter, then the bucket predicate.
    expect(page.where.AND).toEqual([
      activityScopeWhere({ id: 'u1', role: UserRole.SUPERADMIN }),
      { OR: [{ lead: { name: { contains: 'acme', mode: 'insensitive' } } }] },
      { assignees: { some: { userId: { in: [AGENT_ID] } } } },
      { lead: { status: { in: ['New'] } } },
      {},
    ]);
    // Counts share the same base (everything but the bucket), so a badge counts
    // the filtered set.
    const bucketCount = (activityCount.mock.calls as unknown[][])[0][0] as {
      where: { AND: unknown[] };
    };
    expect(bucketCount.where.AND).toHaveLength(4 + 1);
  });

  it('pages with skip/take from page and size', async () => {
    const { service, activityFindMany, activityCount } = makeService();
    activityFindMany.mockReturnValue([]);
    activityCount.mockReturnValue(0);

    await service.list({ bucket: 'all', page: 3, size: 20, ...BOUNDS });

    const args = (activityFindMany.mock.calls as unknown[][])[0][0] as {
      skip: number;
      take: number;
    };
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);
  });
});

describe('ActivitiesService.complete', () => {
  it('completes an in-scope activity and returns it', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: null,
      lead: { name: 'Acme' },
    });
    activityUpdate.mockResolvedValue(
      activityRow({ completedAt: new Date('2026-07-24T10:00:00.000Z') }),
    );

    const item = await service.complete(ACT_ID);

    expect(item.completedAt).toBe('2026-07-24T10:00:00.000Z');
    expect(item.title).toBe('Call with Acme');
    const args = (activityUpdate.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: { completedAt: Date };
    };
    expect(args.where.id).toBe(ACT_ID);
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — keeps the original completedAt when already complete', async () => {
    const done = new Date('2026-07-20T08:00:00.000Z');
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: done,
      lead: { name: 'Acme' },
    });
    activityUpdate.mockResolvedValue(activityRow({ completedAt: done }));

    await service.complete(ACT_ID);

    const args = (activityUpdate.mock.calls as unknown[][])[0][0] as {
      data: { completedAt: Date };
    };
    // reuses the existing timestamp, not a fresh now()
    expect(args.data.completedAt).toBe(done);
  });

  it('404s (and never updates) an out-of-scope or missing activity', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue(null);

    await expect(service.complete(ACT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(activityUpdate).not.toHaveBeenCalled();
  });
});

describe('ActivitiesService.update', () => {
  const editDto = (overrides: Record<string, unknown> = {}) => ({
    type: ActivityType.CALL,
    description: 'call again',
    dueAt: DUE,
    assigneeIds: [AGENT_ID],
    ...overrides,
  });

  it('replaces the fields and the assignee set, and derives the title', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue({ id: ACT_ID, lead: { name: 'Acme' } });
    activityUpdate.mockResolvedValue(
      activityRow({ description: 'call again' }),
    );

    const item = await service.update(ACT_ID, editDto());

    expect(item.title).toBe('Call with Acme');
    const args = (activityUpdate.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(args.where.id).toBe(ACT_ID);
    expect(args.data.description).toBe('call again');
    expect(args.data.assignees).toEqual({
      deleteMany: {},
      create: [{ user: { connect: { id: AGENT_ID } } }],
    });
  });

  it('rejects an End Time on a Call (never updates)', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    await expect(
      service.update(ACT_ID, editDto({ endAt: '2026-08-01T10:00:00.000Z' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(activityFindFirst).not.toHaveBeenCalled();
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it('404s (and never updates) an out-of-scope activity', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue(null);
    await expect(service.update(ACT_ID, editDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it('refuses an edit that hands the follow-up to someone without lead access', async () => {
    const { service, activityFindFirst, activityUpdate, leadCount } =
      makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      leadId: LEAD_ID,
      lead: { name: 'Acme' },
    });
    leadCount.mockResolvedValue(0);

    await expect(service.update(ACT_ID, editDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it('keeps a sales agent on their own activity', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService(
      UserRole.SALES_AGENT,
    );
    activityFindFirst.mockResolvedValue({ id: ACT_ID, lead: { name: 'Acme' } });
    activityUpdate.mockResolvedValue(activityRow());

    await service.update(ACT_ID, editDto({ assigneeIds: [AGENT_ID] }));

    const args = (activityUpdate.mock.calls as unknown[][])[0][0] as {
      data: {
        assignees: { create: { user: { connect: { id: string } } }[] };
      };
    };
    const ids = args.data.assignees.create.map((a) => a.user.connect.id);
    expect(ids).toContain('u1');
    expect(ids).toContain(AGENT_ID);
  });
});

describe('ActivitiesService.duplicate', () => {
  it('copies every field except completion, from the scoped source', async () => {
    const { service, activityFindFirst, activityCreate } = makeService();
    activityFindFirst.mockResolvedValue({
      type: ActivityType.MEETING,
      description: 'meet them',
      dueAt: new Date(DUE),
      endAt: new Date('2026-08-01T10:00:00.000Z'),
      lead: { id: LEAD_ID, name: 'Acme' },
      assignees: [{ userId: AGENT_ID }],
    });
    activityCreate.mockResolvedValue(
      activityRow({ type: ActivityType.MEETING }),
    );

    const item = await service.duplicate(ACT_ID);

    expect(item.title).toBe('Meeting with Acme'); // derived from the created row
    const data = (activityCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data.lead).toEqual({ connect: { id: LEAD_ID } });
    expect(data.data.description).toBe('meet them');
    expect(data.data.assignees).toEqual({
      create: [{ user: { connect: { id: AGENT_ID } } }],
    });
    // A duplicate is a fresh, incomplete follow-up — completion is never carried.
    expect(data.data.completedAt).toBeUndefined();
  });

  it('404s (and never creates) an out-of-scope or missing source', async () => {
    const { service, activityFindFirst, activityCreate } = makeService();
    activityFindFirst.mockResolvedValue(null);

    await expect(service.duplicate(ACT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(activityCreate).not.toHaveBeenCalled();
  });
});

describe('ActivitiesService.delete', () => {
  it('soft-deletes an in-scope activity and returns its id', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue({ id: ACT_ID, deletedAt: null });
    activityUpdate.mockResolvedValue({ id: ACT_ID });

    const result = await service.delete(ACT_ID);

    expect(result).toEqual({ id: ACT_ID });
    const args = (activityUpdate.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: { deletedAt: Date };
    };
    expect(args.where.id).toBe(ACT_ID);
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — a second delete keeps the original deletedAt', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      deletedAt: new Date('2026-07-20T08:00:00.000Z'),
    });

    const result = await service.delete(ACT_ID);

    expect(result).toEqual({ id: ACT_ID });
    // already deleted → no re-stamp
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it('404s (and never updates) an out-of-scope or missing activity', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue(null);

    await expect(service.delete(ACT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(activityUpdate).not.toHaveBeenCalled();
  });
});
