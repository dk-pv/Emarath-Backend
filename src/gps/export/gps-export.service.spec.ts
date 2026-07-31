import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { GpsExportService } from './gps-export.service';
import { ExportGpsQueryDto } from './dto/export-gps-query.dto';

const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const dec = (n: number) => ({ toNumber: () => n });

function makeService(role = 'SALES_AGENT', team: string | null = null) {
  const checkInFindMany = jest.fn().mockResolvedValue([]);
  const pointFindMany = jest.fn().mockResolvedValue([]);
  const activityFindMany = jest.fn().mockResolvedValue([]);
  const userFindMany = jest
    .fn()
    .mockResolvedValue([{ id: AGENT_ID, name: 'Test Agent' }]);

  const prisma = {
    checkIn: { findMany: checkInFindMany },
    locationPoint: { findMany: pointFindMany },
    activity: { findMany: activityFindMany },
    user: { findMany: userFindMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role, team }),
  } as unknown as CurrentUserService;

  return {
    service: new GpsExportService(prisma, currentUser),
    checkInFindMany,
    pointFindMany,
    activityFindMany,
  };
}

function fakeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const end = jest.fn();
  const res = {} as Response;
  Object.assign(res, {
    status: jest.fn(() => res),
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    write: jest.fn((c: unknown) => {
      chunks.push(String(c));
      return true;
    }),
    end,
  });
  return { res, chunks, headers, end };
}

const csv = (chunks: string[]): string => chunks.join('');

function dto(overrides: Partial<ExportGpsQueryDto> = {}): ExportGpsQueryDto {
  return { format: 'csv', ...overrides };
}

describe('GpsExportService (GPS-08.1)', () => {
  it('exports all event types unified, agent-named, time-sorted, with the on-screen columns (AC3/AC4)', async () => {
    const { service, checkInFindMany, pointFindMany, activityFindMany } =
      makeService();
    checkInFindMany.mockResolvedValue([
      {
        agentId: AGENT_ID,
        checkInAt: new Date('2026-07-27T09:00:00Z'),
        checkInLat: dec(25.2),
        checkInLng: dec(55.27),
        checkOutAt: new Date('2026-07-27T10:00:00Z'),
        checkOutLat: dec(25.21),
        checkOutLng: dec(55.28),
        activityId: null,
      },
    ]);
    pointFindMany.mockResolvedValue([
      {
        agentId: AGENT_ID,
        recordedAt: new Date('2026-07-27T11:00:00Z'),
        lat: dec(25.3),
        lng: dec(55.3),
      },
    ]);
    activityFindMany.mockResolvedValue([
      {
        completedAt: new Date('2026-07-27T12:00:00Z'),
        checkIns: [
          { checkInLat: dec(25.4), checkInLng: dec(55.4), agentId: AGENT_ID },
        ],
      },
    ]);

    const { res, chunks, headers, end } = fakeRes();
    await service.export(dto(), res);
    const out = csv(chunks);

    expect(out).toContain('User Name,Date & Time,Status,Latitude,Longitude');
    // All five event kinds present (check-in, check-out, tracking, completion).
    expect(out).toContain('Check-in');
    expect(out).toContain('Check-out');
    expect(out).toContain('Automatic Tracking');
    expect(out).toContain('Follow-up Completion');
    expect(out).toContain('Test Agent');
    expect(out).toContain('25.200000'); // coordinate fixed to 6dp

    // Time-sorted desc: completion (12:00) row precedes the check-in (09:00) row.
    expect(out.indexOf('Follow-up Completion')).toBeLessThan(
      out.indexOf('Check-in'),
    );

    expect(headers['Content-Disposition']).toMatch(
      /attachment; filename="gps-activity-\d{8}-\d{6}\.csv"/,
    );
    expect(headers['Content-Type']).toContain('text/csv');
    expect(end).toHaveBeenCalled();
  });

  it('scopes a SALES_AGENT to their own records (AC2)', async () => {
    const { service, checkInFindMany } = makeService('SALES_AGENT');
    const { res } = fakeRes();
    await service.export(dto(), res);

    const where = (checkInFindMany.mock.calls as unknown[][])[0][0] as {
      where: { agent: unknown };
    };
    expect(where.where.agent).toEqual({ id: AGENT_ID });
  });

  it('scopes a SALES_MANAGER to their team (AUTH-02.1)', async () => {
    const { service, checkInFindMany } = makeService('SALES_MANAGER', 'Sales');
    const { res } = fakeRes();
    await service.export(dto(), res);

    const where = (checkInFindMany.mock.calls as unknown[][])[0][0] as {
      where: { agent: unknown };
    };
    expect(where.where.agent).toEqual({ team: 'Sales' });
  });

  it('intersects a manager Team Member filter with the team, never widening it (§6.2)', async () => {
    const { service, checkInFindMany } = makeService('SALES_MANAGER', 'Sales');
    const other = '99999999-9999-4999-8999-999999999999';
    const { res } = fakeRes();
    await service.export(dto({ userId: other }), res);

    const where = (checkInFindMany.mock.calls as unknown[][])[0][0] as {
      where: { agent: unknown };
    };
    expect(where.where.agent).toEqual({ id: other, team: 'Sales' });
  });

  it('lets an admin narrow to any chosen user (AC2)', async () => {
    const { service, checkInFindMany } = makeService('SUPERADMIN');
    const other = '99999999-9999-4999-8999-999999999999';
    const { res } = fakeRes();
    await service.export(dto({ userId: other }), res);

    const where = (checkInFindMany.mock.calls as unknown[][])[0][0] as {
      where: { agent: unknown };
    };
    expect(where.where.agent).toEqual({ id: other });
  });

  it('rejects an inverted period via the shared resolver (AC5 safety)', async () => {
    const { service } = makeService();
    const { res } = fakeRes();
    await expect(
      service.export(
        dto({
          dateFrom: '2026-07-31T00:00:00Z',
          dateTo: '2026-07-01T00:00:00Z',
        }),
        res,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
