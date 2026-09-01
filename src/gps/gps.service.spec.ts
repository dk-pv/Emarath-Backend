import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { GpsService } from './gps.service';
import { CheckInDto } from './dto/check-in.dto';

const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const CHECK_IN_ID = '66666666-6666-6666-6666-666666666666';
const ACTIVITY_ID = '33333333-3333-3333-3333-333333333333';

/** A row shaped like CHECK_IN_SELECT; coordinates are Prisma Decimals. */
function checkInRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHECK_IN_ID,
    agentId: AGENT_ID,
    checkInAt: new Date('2026-07-27T09:00:00.000Z'),
    checkInLat: new Prisma.Decimal('25.204849'),
    checkInLng: new Prisma.Decimal('55.270783'),
    checkOutAt: null,
    checkOutLat: null,
    checkOutLng: null,
    activityId: ACTIVITY_ID,
    ...overrides,
  };
}

function makeService() {
  const create = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();
  const count = jest.fn();
  const findMany = jest.fn();
  const pointCreate = jest.fn();
  const pointCount = jest.fn();
  const pointFindMany = jest.fn();
  const activityCount = jest.fn();
  const activityFindMany = jest.fn();
  const activityFindUnique = jest.fn();
  const userFindMany = jest.fn();

  const prisma = {
    checkIn: { create, findFirst, update, count, findMany },
    locationPoint: {
      create: pointCreate,
      count: pointCount,
      findMany: pointFindMany,
    },
    activity: {
      count: activityCount,
      findMany: activityFindMany,
      findUnique: activityFindUnique,
    },
    user: { findMany: userFindMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role: 'SALES_AGENT' }),
  } as unknown as CurrentUserService;

  const config = {
    getOrThrow: jest.fn().mockReturnValue({ checkInRadiusMeters: 150 }),
  } as unknown as ConfigService;

  return {
    service: new GpsService(prisma, currentUser, config),
    create,
    findFirst,
    update,
    count,
    findMany,
    pointCreate,
    pointCount,
    pointFindMany,
    activityCount,
    activityFindMany,
    activityFindUnique,
    userFindMany,
    config,
  };
}

function dto(overrides: Partial<CheckInDto> = {}): CheckInDto {
  return {
    latitude: 25.204849,
    longitude: 55.270783,
    activityId: ACTIVITY_ID,
    ...overrides,
  };
}

function p2003(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: 'test',
  });
}

describe('GpsService.checkIn', () => {
  it('records a check-in attributed to the calling agent, coords as numbers (AC1/AC4)', async () => {
    const { service, create } = makeService();
    create.mockResolvedValue(checkInRow());

    const result = await service.checkIn(dto());

    expect(result).toMatchObject({
      agentId: AGENT_ID,
      checkInLat: 25.204849,
      checkInLng: 55.270783,
      activityId: ACTIVITY_ID,
    });
    const data = (create.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data).toMatchObject({ agentId: AGENT_ID });
  });

  it('maps a bad activityId foreign key to a 400 (AC5-adjacent)', async () => {
    const { service, create } = makeService();
    create.mockRejectedValue(p2003());
    await expect(service.checkIn(dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('GpsService.checkOut', () => {
  it('closes the agent’s open check-in (AC2)', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue({ id: CHECK_IN_ID });
    update.mockResolvedValue(
      checkInRow({
        checkOutAt: new Date('2026-07-27T10:00:00.000Z'),
        checkOutLat: new Prisma.Decimal('25.204900'),
        checkOutLng: new Prisma.Decimal('55.270900'),
      }),
    );

    const result = await service.checkOut(CHECK_IN_ID, {
      latitude: 25.2049,
      longitude: 55.2709,
    });

    expect(result.checkOutAt).not.toBeNull();
    expect(result.checkOutLat).toBe(25.2049);
    // Only the caller's own, still-open check-in is eligible.
    const where = (findFirst.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      id: CHECK_IN_ID,
      agentId: AGENT_ID,
      deletedAt: null,
      checkOutAt: null,
    });
  });

  it('404s when there is no open check-in to close', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue(null);
    await expect(
      service.checkOut(CHECK_IN_ID, { latitude: 25, longitude: 55 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * The boolean gate the Activities service calls. GPS-09.1 changed what "valid"
 * means — a check-in must now also be near the site — so these assert through the
 * real proximity path rather than the old existence count.
 */
describe('GpsService.hasValidCheckIn', () => {
  const site = {
    id: '77777777-7777-7777-7777-777777777777',
    name: 'Kozhikode Depot',
    lat: new Prisma.Decimal('11.258800'),
    lng: new Prisma.Decimal('75.780400'),
    radiusMeters: null,
  };

  it('is true when the agent has a nearby check-in for the activity (AC3)', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([
      {
        id: CHECK_IN_ID,
        checkInLat: new Prisma.Decimal('11.259300'),
        checkInLng: new Prisma.Decimal('75.780400'),
      },
    ]);

    await expect(service.hasValidCheckIn(AGENT_ID, ACTIVITY_ID)).resolves.toBe(
      true,
    );
    const args = (findMany.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      agentId: AGENT_ID,
      activityId: ACTIVITY_ID,
      deletedAt: null,
    });
  });

  it('is false when the agent has none', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([]);
    await expect(service.hasValidCheckIn(AGENT_ID, ACTIVITY_ID)).resolves.toBe(
      false,
    );
  });
});

const POINT_ID = '77777777-7777-7777-7777-777777777777';
const RECORDED_AT = new Date('2026-07-27T09:30:00.000Z');

/** A row shaped like LOCATION_POINT_SELECT; coordinates are Prisma Decimals. */
function pointRow(overrides: Record<string, unknown> = {}) {
  return {
    id: POINT_ID,
    agentId: AGENT_ID,
    recordedAt: RECORDED_AT,
    lat: new Prisma.Decimal('25.204849'),
    lng: new Prisma.Decimal('55.270783'),
    ...overrides,
  };
}

describe('GpsService.recordPoint', () => {
  it('GPS-03.1: persists a point attributed to the calling agent with coords as numbers', async () => {
    const { service, pointCreate } = makeService();
    pointCreate.mockResolvedValue(pointRow());

    const result = await service.recordPoint({
      latitude: 25.204849,
      longitude: 55.270783,
    });

    expect(result).toMatchObject({
      id: POINT_ID,
      agentId: AGENT_ID,
      lat: 25.204849,
      lng: 55.270783,
    });
    const data = (pointCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data).toMatchObject({ agentId: AGENT_ID });
  });

  it('GPS-03.1: defaults recordedAt to now when at is omitted', async () => {
    const { service, pointCreate } = makeService();
    pointCreate.mockResolvedValue(pointRow());

    await service.recordPoint({ latitude: 25, longitude: 55 });

    const data = (pointCreate.mock.calls as unknown[][])[0][0] as {
      data: { recordedAt: Date };
    };
    expect(data.data.recordedAt).toBeInstanceOf(Date);
  });

  it('GPS-03.1: uses the explicit at timestamp when provided', async () => {
    const { service, pointCreate } = makeService();
    pointCreate.mockResolvedValue(pointRow());

    await service.recordPoint({
      latitude: 25,
      longitude: 55,
      at: '2026-07-27T08:00:00.000Z',
    });

    const data = (pointCreate.mock.calls as unknown[][])[0][0] as {
      data: { recordedAt: Date };
    };
    expect(data.data.recordedAt).toEqual(new Date('2026-07-27T08:00:00.000Z'));
  });
});

describe('GpsService.getSummary', () => {
  it('GPS-04.1: returns counts for the 5 KPIs scoped to the calling SALES_AGENT', async () => {
    const { service, count, pointCount, activityCount } = makeService();
    count.mockResolvedValue(5);
    pointCount.mockResolvedValue(10);
    activityCount.mockResolvedValue(3);

    const result = await service.getSummary({});

    expect(result).toMatchObject({
      totalCheckIns: 5,
      totalCheckOuts: 5,
      locationCheckIns: 5,
      automaticTracking: 10,
      followUpCompletions: 3,
    });

    const where = (count.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      agent: { id: AGENT_ID },
      deletedAt: null,
    });
  });

  it('GPS-04.1: applies period filter when dateFrom and dateTo are provided', async () => {
    const { service, pointCount } = makeService();
    pointCount.mockResolvedValue(0);

    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-07-31T23:59:59.000Z';
    await service.getSummary({ dateFrom: from, dateTo: to });

    const where = (pointCount.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      recordedAt: { gte: new Date(from), lte: new Date(to) },
    });
  });
});

describe('GpsService.getLocations', () => {
  it('GPS-05.1: fetches and unifies coordinate pins across all types', async () => {
    const { service, findMany, pointFindMany, activityFindMany, userFindMany } =
      makeService();
    userFindMany.mockResolvedValue([{ id: AGENT_ID, name: 'Test Agent' }]);

    findMany.mockResolvedValue([
      {
        id: 'in-1',
        agentId: AGENT_ID,
        checkInLat: { toNumber: () => 10 },
        checkInLng: { toNumber: () => 20 },
        checkInAt: new Date('2026-07-27T10:00:00Z'),
        checkOutLat: null,
        checkOutLng: null,
        checkOutAt: null,
        activityId: null,
      },
    ]);
    pointFindMany.mockResolvedValue([
      {
        id: 'pt-1',
        agentId: AGENT_ID,
        lat: { toNumber: () => 15 },
        lng: { toNumber: () => 25 },
        recordedAt: new Date('2026-07-27T11:00:00Z'),
      },
    ]);
    activityFindMany.mockResolvedValue([
      {
        id: 'act-1',
        completedAt: new Date('2026-07-27T12:00:00Z'),
        checkIns: [
          {
            checkInLat: { toNumber: () => 30 },
            checkInLng: { toNumber: () => 40 },
            agentId: AGENT_ID,
          },
        ],
      },
    ]);

    const result = await service.getLocations({});

    expect(result).toHaveLength(3);
    // Should be sorted by timestamp descending
    expect(result[0].type).toBe('FOLLOW_UP_COMPLETION');
    expect(result[1].type).toBe('AUTOMATIC_TRACKING');
    expect(result[2].type).toBe('CHECK_IN');
    // GPS-06.1: pins carry the resolved agent display name.
    expect(result[0].agentName).toBe('Test Agent');
  });
});

/**
 * GPS-09.1 — location-verified completion.
 *
 * The site sits at the Kozhikode centre the fixture uses. `nearby` is ~55 m away
 * (inside the 150 m default) and `farAway` ~1.2 km, so the two sides of the gate are
 * unambiguous rather than borderline.
 */
describe('GpsService.verifyLocationCheckIn (GPS-09.1)', () => {
  const LOCATION_ID = '77777777-7777-7777-7777-777777777777';
  const site = {
    id: LOCATION_ID,
    name: 'Kozhikode Depot',
    lat: new Prisma.Decimal('11.258800'),
    lng: new Prisma.Decimal('75.780400'),
    radiusMeters: null,
  };
  const nearby = {
    id: CHECK_IN_ID,
    checkInLat: new Prisma.Decimal('11.259300'),
    checkInLng: new Prisma.Decimal('75.780400'),
  };
  const farAway = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    checkInLat: new Prisma.Decimal('11.269800'),
    checkInLng: new Prisma.Decimal('75.780400'),
  };

  it('accepts a nearby check-in and reports which one satisfied the gate (AC1, AC3)', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([nearby]);

    const verdict = await service.verifyLocationCheckIn(AGENT_ID, ACTIVITY_ID);

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('expected ok');
    expect(verdict.checkInId).toBe(CHECK_IN_ID);
    expect(verdict.meters).toBeLessThan(150);
  });

  it('blocks when the agent has no check-in for the follow-up (AC2)', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([]);

    const verdict = await service.verifyLocationCheckIn(AGENT_ID, ACTIVITY_ID);

    expect(verdict).toEqual({ ok: false, reason: 'NO_CHECK_IN' });
  });

  it('blocks a check-in outside the radius and says how far it was (AC1, AC2)', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([farAway]);

    const verdict = await service.verifyLocationCheckIn(AGENT_ID, ACTIVITY_ID);

    expect(verdict.ok).toBe(false);
    if (verdict.ok || verdict.reason !== 'TOO_FAR')
      throw new Error('expected TOO_FAR');
    expect(verdict.meters).toBeGreaterThan(1000);
    expect(verdict.radius).toBe(150);
    expect(verdict.locationName).toBe('Kozhikode Depot');
  });

  it('never considers another agent’s check-in — the query is scoped to the caller (AC2)', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([]);

    const verdict = await service.verifyLocationCheckIn(AGENT_ID, ACTIVITY_ID);

    expect(verdict).toEqual({ ok: false, reason: 'NO_CHECK_IN' });
    // The agent is a query condition, so a foreign check-in is never a candidate.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId: AGENT_ID, activityId: ACTIVITY_ID, deletedAt: null },
      }),
    );
  });

  it('picks the nearest check-in when the agent has several', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([farAway, nearby]);

    const verdict = await service.verifyLocationCheckIn(AGENT_ID, ACTIVITY_ID);

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('expected ok');
    expect(verdict.checkInId).toBe(CHECK_IN_ID);
  });

  it('honours a site’s own radius over the configured default', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({
      location: { ...site, radiusMeters: 2000 },
    });
    findMany.mockResolvedValue([farAway]);

    const verdict = await service.verifyLocationCheckIn(AGENT_ID, ACTIVITY_ID);

    expect(verdict.ok).toBe(true);
  });

  it('fails closed when the follow-up points at a site that no longer exists', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: null });

    const verdict = await service.verifyLocationCheckIn(AGENT_ID, ACTIVITY_ID);

    expect(verdict).toEqual({ ok: false, reason: 'NO_LOCATION' });
    // No point querying check-ins when there is nothing to measure against.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('hasValidCheckIn stays a boolean view of the same rule', async () => {
    const { service, activityFindUnique, findMany } = makeService();
    activityFindUnique.mockResolvedValue({ location: site });
    findMany.mockResolvedValue([nearby]);

    await expect(service.hasValidCheckIn(AGENT_ID, ACTIVITY_ID)).resolves.toBe(
      true,
    );
  });
});
