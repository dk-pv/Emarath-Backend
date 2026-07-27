import {
  CallDirection,
  CallOutcome,
  UserRole,
} from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CallLookupService } from './call-lookup.service';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const PHONE = '+971500000000';

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const leadFindFirst = jest.fn();
  const callFindMany = jest.fn();

  const prisma = {
    lead: { findFirst: leadFindFirst },
    call: { findMany: callFindMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: AGENT_ID, role }),
  } as unknown as CurrentUserService;

  const service = new CallLookupService(prisma, currentUser);
  return { service, leadFindFirst, callFindMany };
}

describe('CallLookupService.matchLeadIdByPhone (unscoped, for ingestion)', () => {
  it('resolves a number to a live lead id (AC1)', async () => {
    const { service, leadFindFirst } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });

    await expect(service.matchLeadIdByPhone(PHONE)).resolves.toBe(LEAD_ID);
    const args = (leadFindFirst.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      deletedAt: null,
      OR: [{ primaryPhone: PHONE }, { secondaryPhone: PHONE }],
    });
  });

  it('returns null for an unmatched number without error (AC4)', async () => {
    const { service, leadFindFirst } = makeService();
    leadFindFirst.mockResolvedValue(null);
    await expect(service.matchLeadIdByPhone(PHONE)).resolves.toBeNull();
  });

  it('returns null for a blank number without querying', async () => {
    const { service, leadFindFirst } = makeService();
    await expect(service.matchLeadIdByPhone('   ')).resolves.toBeNull();
    expect(leadFindFirst).not.toHaveBeenCalled();
  });
});

describe('CallLookupService.findContact (role-scoped)', () => {
  it('composes the caller scope with the number match for a sales agent (AC5)', async () => {
    const { service, leadFindFirst } = makeService(UserRole.SALES_AGENT);
    leadFindFirst.mockResolvedValue({
      id: LEAD_ID,
      name: 'Acme',
      primaryPhone: PHONE,
      status: 'New',
      pipeline: 'Lead Pipeline',
    });

    await service.findContact(PHONE);

    const args = (leadFindFirst.mock.calls as unknown[][])[0][0] as {
      where: { AND: Record<string, unknown>[] };
    };
    // The first AND clause is the lead scope — a sales agent is narrowed to
    // their own assignments, so another agent's contact never surfaces.
    expect(args.where.AND[0]).toMatchObject({
      deletedAt: null,
      assignments: { some: { userId: AGENT_ID } },
    });
    expect(args.where.AND[1]).toMatchObject({
      OR: [{ primaryPhone: PHONE }, { secondaryPhone: PHONE }],
    });
  });

  it('returns null for an unmatched number (AC4)', async () => {
    const { service, leadFindFirst } = makeService();
    leadFindFirst.mockResolvedValue(null);
    await expect(service.findContact(PHONE)).resolves.toBeNull();
  });
});

describe('CallLookupService.getCallHistory (role-scoped)', () => {
  it("returns the matched contact's calls newest first (AC2)", async () => {
    const { service, leadFindFirst, callFindMany } = makeService();
    leadFindFirst.mockResolvedValue({
      id: LEAD_ID,
      name: 'Acme',
      primaryPhone: PHONE,
      status: 'New',
      pipeline: 'Lead Pipeline',
    });
    callFindMany.mockResolvedValue([
      {
        id: 'c1',
        phone: PHONE,
        startedAt: new Date('2026-07-27T09:00:00.000Z'),
        direction: CallDirection.OUTBOUND,
        outcome: CallOutcome.ANSWERED,
        duration: 42,
      },
    ]);

    const history = await service.getCallHistory(PHONE);

    expect(history).toHaveLength(1);
    const args = (callFindMany.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({ deletedAt: null, leadId: LEAD_ID });
    expect(args.orderBy).toEqual({ startedAt: 'desc' });
  });

  it('returns an empty list for an unmatched contact without querying calls (AC4)', async () => {
    const { service, leadFindFirst, callFindMany } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(service.getCallHistory(PHONE)).resolves.toEqual([]);
    expect(callFindMany).not.toHaveBeenCalled();
  });
});
