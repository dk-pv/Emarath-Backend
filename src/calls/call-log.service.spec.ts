import {
  CallDirection,
  CallOutcome,
  UserRole,
} from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CallLogService } from './call-log.service';
import { CallLogQueryDto } from './dto/call-log-query.dto';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const CALL_ID = '44444444-4444-4444-4444-444444444444';
const TAG_ID = '55555555-5555-5555-5555-555555555555';
const FROM = '2026-07-27T00:00:00.000Z';
const TO = '2026-07-28T00:00:00.000Z';

type Where = {
  outcome?: CallOutcome;
  agentId?: string;
  startedAt?: { gte: Date; lt: Date };
  lead?: Record<string, unknown>;
  OR?: unknown[];
};

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CALL_ID,
    leadId: LEAD_ID,
    phone: '+971500000000',
    startedAt: new Date('2026-07-27T09:00:00.000Z'),
    outcome: CallOutcome.ANSWERED,
    direction: CallDirection.OUTBOUND,
    leadNotes: 'lead note',
    callNotes: 'call note',
    audioUrl: null,
    flagged: false,
    lead: {
      name: 'Acme',
      status: 'New',
      source: 'Broadcast',
      pipeline: 'Lead Pipeline',
      assignments: [{ user: { id: USER_ID, name: 'Agent One' } }],
      tags: [{ tag: { id: TAG_ID, name: 'VIP' } }],
    },
    ...overrides,
  };
}

function makeService(
  rows: Record<string, unknown>[] = [callRow()],
  total = 1,
  followUps: { leadId: string; _min: { dueAt: Date | null } }[] = [],
  role: UserRole = UserRole.SUPERADMIN,
) {
  const callFindMany = jest.fn().mockResolvedValue(rows);
  const callCount = jest.fn().mockResolvedValue(total);
  const activityGroupBy = jest.fn().mockResolvedValue(followUps);
  // $transaction receives the ops array; resolve it to [rows, total].
  const $transaction = jest.fn(() => Promise.resolve([rows, total]));

  const prisma = {
    call: { findMany: callFindMany, count: callCount },
    activity: { groupBy: activityGroupBy },
    $transaction,
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: USER_ID, role }),
  } as unknown as CurrentUserService;

  const service = new CallLogService(prisma, currentUser);
  return { service, callFindMany, activityGroupBy };
}

function query(overrides: Partial<CallLogQueryDto> = {}): CallLogQueryDto {
  return { from: FROM, to: TO, page: 1, size: 20, ...overrides };
}

describe('CallLogService.getLog', () => {
  it('returns a page of rows with all backlog fields + direction + total (AC1/AC2/AC3)', async () => {
    const { service } = makeService([callRow()], 1, [
      {
        leadId: LEAD_ID,
        _min: { dueAt: new Date('2026-07-30T09:00:00.000Z') },
      },
    ]);
    const result = await service.getLog(query());
    expect(result).toMatchObject({ total: 1, page: 1, size: 20 });
    expect(result.rows[0]).toMatchObject({
      leadId: LEAD_ID,
      leadName: 'Acme',
      phone: '+971500000000',
      outcome: CallOutcome.ANSWERED,
      direction: CallDirection.OUTBOUND,
      leadStatus: 'New',
      leadNotes: 'lead note',
      callNotes: 'call note',
      nextFollowUp: new Date('2026-07-30T09:00:00.000Z'),
    });
  });

  it('flattens the lead-derived columns the log offers', async () => {
    const { service } = makeService();
    const [row] = (await service.getLog(query())).rows;
    expect(row).toMatchObject({
      leadSource: 'Broadcast',
      leadPipeline: 'Lead Pipeline',
      assignedTo: [{ id: USER_ID, name: 'Agent One' }],
      tags: [{ id: TAG_ID, name: 'VIP' }],
      audioUrl: null,
      flagged: false,
    });
  });

  it('orders chronologically (most recent first) and paginates (AC1, §8)', async () => {
    const { service, callFindMany } = makeService();
    await service.getLog(query({ page: 3, size: 25 }));
    const args = (callFindMany.mock.calls as unknown[][])[0][0] as {
      orderBy: unknown;
      skip: number;
      take: number;
    };
    expect(args.orderBy).toEqual({ startedAt: 'desc' });
    expect(args.skip).toBe(50); // (3 - 1) × 25
    expect(args.take).toBe(25);
  });

  it('filters by outcome when supplied (AC4)', async () => {
    const { service, callFindMany } = makeService();
    await service.getLog(query({ outcome: CallOutcome.NO_ANSWER }));
    const { where } = (callFindMany.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    expect(where.outcome).toBe(CallOutcome.NO_ANSWER);
  });

  it('searches by lead name or phone (AC4)', async () => {
    const { service, callFindMany } = makeService();
    await service.getLog(query({ search: 'acme' }));
    const { where } = (callFindMany.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    expect(where.OR).toEqual([
      { lead: { name: { contains: 'acme', mode: 'insensitive' } } },
      { phone: { contains: 'acme' } },
    ]);
  });

  it('filters by lead status, merged into the scoped lead relation (CALL-06.1)', async () => {
    const { service, callFindMany } = makeService();
    await service.getLog(query({ leadStatus: 'HOT' }));
    const { where } = (callFindMany.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    expect(where.lead).toMatchObject({ deletedAt: null, status: 'HOT' });
  });

  it('filters by agent when supplied (CALL-06.1)', async () => {
    const { service, callFindMany } = makeService();
    await service.getLog(query({ agentId: USER_ID }));
    const { where } = (callFindMany.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    expect(where.agentId).toBe(USER_ID);
  });

  it('scopes the log to the caller for a sales agent (AC5)', async () => {
    const { service, callFindMany } = makeService(
      [],
      0,
      [],
      UserRole.SALES_AGENT,
    );
    await service.getLog(query());
    const { where } = (callFindMany.mock.calls as unknown[][])[0][0] as {
      where: Where;
    };
    expect(where.lead).toMatchObject({
      assignments: { some: { userId: USER_ID } },
    });
  });

  it('returns a null next-follow-up when the lead has none', async () => {
    const { service } = makeService([callRow()], 1, []);
    const result = await service.getLog(query());
    expect(result.rows[0].nextFollowUp).toBeNull();
  });
});
