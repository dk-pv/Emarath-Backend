import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  const userFindMany = jest.fn();

  const prisma = {
    checkIn: { create, findFirst, update, count, findMany },
    locationPoint: {
      create: pointCreate,
      count: pointCount,
      findMany: pointFindMany,
    },
    activity: { count: activityCount, findMany: activityFindMany },
    user: { findMany: userFindMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role: 'SALES_AGENT' }),
  } as unknown as CurrentUserService;

  return {
    service: new GpsService(prisma, currentUser),
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
    userFindMany,
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

describe('GpsService.hasValidCheckIn', () => {
  it('is true when the agent has a check-in for the activity (AC3)', async () => {
    const { service, count } = makeService();
    count.mockResolvedValue(1);
    await expect(service.hasValidCheckIn(AGENT_ID, ACTIVITY_ID)).resolves.toBe(
      true,
    );
    const args = (count.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      agentId: AGENT_ID,
      activityId: ACTIVITY_ID,
      deletedAt: null,
    });
  });

  it('is false when the agent has none', async () => {
    const { service, count } = makeService();
    count.mockResolvedValue(0);
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
