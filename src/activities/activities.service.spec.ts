import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { GpsService } from '../gps/gps.service';
import { ActivitiesService, LOCATION_GATE_MESSAGE } from './activities.service';
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
    locationId: null,
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
  // $transaction runs the ops array and resolves to the ops' return values —
  // exactly what the real client does, so the mocked findMany/count values flow
  // straight through.
  const $transaction = jest.fn((ops: unknown[]) => Promise.resolve(ops));

  const prisma = {
    lead: { findFirst: leadFindFirst },
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

  // The GPS gate (ACT-10.1 / GPS-02.1): no valid check-in by default, so a
  // location-tied completion is blocked unless a test says otherwise.
  const gpsVerify = jest
    .fn()
    .mockResolvedValue({ ok: false, reason: 'NO_CHECK_IN' });
  const gpsHasValidCheckIn = jest.fn().mockResolvedValue(false);
  const gps = {
    verifyLocationCheckIn: gpsVerify,
    hasValidCheckIn: gpsHasValidCheckIn,
  } as unknown as GpsService;

  const service = new ActivitiesService(prisma, currentUser, gps);
  return {
    service,
    leadFindFirst,
    activityCreate,
    activityFindMany,
    activityCount,
    activityFindFirst,
    activityUpdate,
    gpsHasValidCheckIn,
    gpsVerify,
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
    locationId: null,
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
    expect(data.data.location).toBeUndefined();
    expect(data.data.assignees).toEqual({
      create: [{ user: { connect: { id: AGENT_ID } } }],
    });
  });

  it('accepts an End Time and Location on a Meeting', async () => {
    const { service, leadFindFirst, activityCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID, name: 'Acme' });
    activityCreate.mockResolvedValue(
      activityRow({ type: ActivityType.MEETING }),
    );
    const end = '2026-08-01T10:00:00.000Z';
    const loc = '44444444-4444-4444-4444-444444444444';

    await service.create(
      makeDto({ type: ActivityType.MEETING, endAt: end, locationId: loc }),
    );

    const data = (activityCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data.endAt).toEqual(new Date(end));
    expect(data.data.location).toEqual({ connect: { id: loc } });
  });

  it('rejects an End Time on a Call', async () => {
    const { service, activityCreate } = makeService();
    await expect(
      service.create(makeDto({ endAt: '2026-08-01T10:00:00.000Z' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('rejects a Location on a Call', async () => {
    const { service, activityCreate } = makeService();
    await expect(
      service.create(
        makeDto({ locationId: '44444444-4444-4444-4444-444444444444' }),
      ),
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
    // consumed in order: page total, then overdue/today/tomorrow/completed/all.
    activityCount
      .mockReturnValueOnce(1)
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

    expect(res.total).toBe(1);
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
    expect(args.where.AND[0]).toEqual({
      deletedAt: null,
      assignees: { some: { userId: 'u1' } },
    });
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
      { deletedAt: null },
      { OR: [{ lead: { name: { contains: 'acme', mode: 'insensitive' } } }] },
      { assignees: { some: { userId: { in: [AGENT_ID] } } } },
      { lead: { status: { in: ['New'] } } },
      {},
    ]);
    // Counts share the same base (everything but the bucket), so a badge counts
    // the filtered set. First count call is the page total; the next is a bucket.
    const bucketCount = (activityCount.mock.calls as unknown[][])[1][0] as {
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
      locationId: null,
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
      locationId: null,
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

  // ACT-10.1 — location gate (AC1, AC2, AC3)
  it('ACT-10.1 blocks completion of a location-tied activity with a 409', async () => {
    const LOC_ID = '55555555-5555-5555-5555-555555555555';
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: null,
      locationId: LOC_ID,
      lead: { name: 'Acme' },
    });

    await expect(service.complete(ACT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // the gate must not write completedAt (AC2)
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it('ACT-10.1 message is the blueprint-specified string (AC3)', async () => {
    const LOC_ID = '55555555-5555-5555-5555-555555555555';
    const { service, activityFindFirst } = makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: null,
      locationId: LOC_ID,
      lead: { name: 'Acme' },
    });

    let caught: unknown;
    try {
      await service.complete(ACT_ID);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).message).toBe(LOCATION_GATE_MESSAGE);
  });

  // GPS-09.1 AC2 — the refusal says *why*, not just "no".
  it('GPS-09.1 explains a too-far check-in with the distance and radius', async () => {
    const LOC_ID = '55555555-5555-5555-5555-555555555555';
    const { service, activityFindFirst, activityUpdate, gpsVerify } =
      makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: null,
      locationId: LOC_ID,
      lead: { name: 'Acme' },
    });
    gpsVerify.mockResolvedValue({
      ok: false,
      reason: 'TOO_FAR',
      meters: 182.37,
      radius: 150,
      locationName: 'Kozhikode Depot',
    });

    let caught: unknown;
    try {
      await service.complete(ACT_ID);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).message).toBe(
      'Your check-in was 182 m from Kozhikode Depot, outside the 150 m required to complete this activity.',
    );
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it('GPS-09.1 keeps the plain message when there is no check-in at all', async () => {
    const LOC_ID = '55555555-5555-5555-5555-555555555555';
    const { service, activityFindFirst, gpsVerify } = makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: null,
      locationId: LOC_ID,
      lead: { name: 'Acme' },
    });
    gpsVerify.mockResolvedValue({ ok: false, reason: 'NO_CHECK_IN' });

    await expect(service.complete(ACT_ID)).rejects.toThrow(
      LOCATION_GATE_MESSAGE,
    );
  });

  // ACT-10.1 — AC4: non-location activities complete normally
  it('ACT-10.1 does not gate activities without a location (AC4)', async () => {
    const { service, activityFindFirst, activityUpdate } = makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: null,
      locationId: null,
      lead: { name: 'Acme' },
    });
    activityUpdate.mockResolvedValue(
      activityRow({ completedAt: new Date('2026-07-24T10:00:00.000Z') }),
    );

    // must not throw
    await expect(service.complete(ACT_ID)).resolves.toBeDefined();
    expect(activityUpdate).toHaveBeenCalledTimes(1);
  });

  // GPS-02.1 AC3: a valid check-in satisfies the location gate.
  it('completes a location-tied activity once the agent has a valid check-in (GPS-02.1)', async () => {
    const LOC_ID = '55555555-5555-5555-5555-555555555555';
    const { service, activityFindFirst, activityUpdate, gpsVerify } =
      makeService();
    activityFindFirst.mockResolvedValue({
      id: ACT_ID,
      completedAt: null,
      locationId: LOC_ID,
      lead: { name: 'Acme' },
    });
    gpsVerify.mockResolvedValue({ ok: true, checkInId: 'c1', meters: 12 });
    activityUpdate.mockResolvedValue(
      activityRow({ completedAt: new Date('2026-07-24T10:00:00.000Z') }),
    );

    await expect(service.complete(ACT_ID)).resolves.toBeDefined();
    expect(gpsVerify).toHaveBeenCalledWith('u1', ACT_ID);
    expect(activityUpdate).toHaveBeenCalledTimes(1);
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
      locationId: '44444444-4444-4444-4444-444444444444',
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
    expect(data.data.location).toEqual({
      connect: { id: '44444444-4444-4444-4444-444444444444' },
    });
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
