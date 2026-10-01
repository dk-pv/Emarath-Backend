import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { StagesService } from '../../stages/stages.service';
import { LeadsBoardService } from './leads-board.service';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';

/** A minimal Decimal-like: only `toString` is read by the mapper. */
const dec = (v: string) => ({ toString: () => v });
const emptyOverall = { _count: 0, _sum: { actualAmount: null } };

/** A row shaped like LEAD_LIST_SELECT — enough for toLeadListItem to run. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    name: 'Acme',
    firstName: null,
    primaryPhone: '900',
    secondaryPhone: null,
    language: null,
    country: null,
    source: null,
    status: 'HOT',
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

/** A row shaped like the audit select (ADR-0083) — only what the log compares. */
function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    status: 'HOT',
    lostReason: null,
    pipeline: 'Lead Pipeline',
    deletedAt: null,
    assignments: [],
    tags: [],
    customFieldValues: [],
    complaints: [],
    ...overrides,
  };
}

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const groupBy = jest.fn();
  const aggregate = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();
  // The audit reads (before/after the move) and the audit write (ADR-0083).
  const auditFindMany = jest.fn().mockResolvedValue([]);
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    lead: { update, findMany: auditFindMany },
    auditEvent: { createMany: auditCreateMany },
    // The conversion hook (ADR-0085): `createManyAndReturn` echoes what it was asked to
    // insert, so a lead that becomes WON gets an order id on its CONVERTED event.
    logisticsOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      createManyAndReturn: jest.fn((args: { data: { leadId: string }[] }) =>
        Promise.resolve(
          args.data.map((row, index) => ({
            id: `order-${index + 1}`,
            leadId: row.leadId,
            orderNumber: 1000 + index,
            status: 'INITIAL',
          })),
        ),
      ),
    },
  };
  // `update` exists only on `tx`: a move that escaped the audit transaction would throw.
  const prisma = {
    lead: { groupBy, aggregate, findFirst },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;
  // A move validates its target against the canonical catalogue; valid by default.
  const exists = jest.fn().mockResolvedValue(true);
  const stages = { exists } as unknown as StagesService;
  const service = new LeadsBoardService(prisma, currentUser, stages);
  return {
    service,
    groupBy,
    aggregate,
    findFirst,
    update,
    exists,
    auditFindMany,
    auditCreateMany,
  };
}

describe('LeadsBoardService.board', () => {
  it('groups leads by stage with count and total value, ordered by stage (AC1/AC2)', async () => {
    const { service, groupBy, aggregate } = makeService();
    groupBy.mockResolvedValue([
      { status: 'New', _count: 104, _sum: { actualAmount: dec('509') } },
      { status: 'HOT', _count: 143, _sum: { actualAmount: dec('1200') } },
      { status: 'Cold', _count: 12, _sum: { actualAmount: null } },
    ]);
    aggregate.mockResolvedValue({
      _count: 259,
      _sum: { actualAmount: dec('1709') },
    });

    const res = await service.board({ pipeline: 'Lead Pipeline' });

    expect(res.pipeline).toBe('Lead Pipeline');
    // Sorted by stage name: Cold, HOT, New.
    expect(res.stages).toEqual([
      { stage: 'Cold', count: 12, totalValue: '0' },
      { stage: 'HOT', count: 143, totalValue: '1200' },
      { stage: 'New', count: 104, totalValue: '509' },
    ]);
    expect(res.totals).toEqual({ count: 259, totalValue: '1709' });
  });

  it('narrows to the selected pipeline and scopes the query (AC3/AC4)', async () => {
    const { service, groupBy, aggregate } = makeService();
    groupBy.mockResolvedValue([]);
    aggregate.mockResolvedValue(emptyOverall);

    await service.board({ pipeline: 'LOGISTICS' });

    const args = (groupBy.mock.calls as unknown[][])[0][0] as {
      by: string[];
      where: { AND: Record<string, unknown>[] };
    };
    expect(args.by).toEqual(['status']);
    // Scope (deletedAt: null) AND the pipeline filter are both present.
    expect(args.where.AND).toContainEqual({ pipeline: 'LOGISTICS' });
    expect(args.where.AND).toContainEqual({ deletedAt: null });
  });

  it('narrows the rollup by the same search and filters as the list (KAN-07.1 AC1/AC5)', async () => {
    const { service, groupBy, aggregate } = makeService();
    groupBy.mockResolvedValue([]);
    aggregate.mockResolvedValue(emptyOverall);

    await service.board({
      pipeline: 'Lead Pipeline',
      search: 'acme',
      source: ['Broadcast'],
      status: ['New'],
    });

    const args = (groupBy.mock.calls as unknown[][])[0][0] as {
      where: { AND: Record<string, unknown>[] };
    };
    // The search and each field filter reach the groupBy `where`, ANDed with scope
    // and pipeline — the identical fragments the list builds from the same query.
    expect(args.where.AND).toContainEqual({ pipeline: 'Lead Pipeline' });
    expect(args.where.AND).toContainEqual({ source: { in: ['Broadcast'] } });
    expect(args.where.AND).toContainEqual({ status: { in: ['New'] } });
    expect(args.where.AND).toContainEqual({
      OR: [
        { name: { contains: 'acme', mode: 'insensitive' } },
        { primaryPhone: { contains: 'acme' } },
      ],
    });
  });

  it('defaults an absent pipeline to the sales board (KAN-02.1)', async () => {
    const { service, groupBy, aggregate } = makeService();
    groupBy.mockResolvedValue([]);
    aggregate.mockResolvedValue(emptyOverall);

    const res = await service.board({});

    expect(res.pipeline).toBe('Lead Pipeline');
    const args = (groupBy.mock.calls as unknown[][])[0][0] as {
      where: { AND: Record<string, unknown>[] };
    };
    expect(args.where.AND).toContainEqual({ pipeline: 'Lead Pipeline' });
  });

  it('returns an empty board cleanly when a pipeline has no leads', async () => {
    const { service, groupBy, aggregate } = makeService();
    groupBy.mockResolvedValue([]);
    aggregate.mockResolvedValue(emptyOverall);

    const res = await service.board({ pipeline: 'QC' });

    expect(res.stages).toEqual([]);
    expect(res.totals).toEqual({ count: 0, totalValue: '0' });
  });

  it('scopes a sales agent to their own assignments (AC3)', async () => {
    const { service, groupBy, aggregate } = makeService(UserRole.SALES_AGENT);
    groupBy.mockResolvedValue([]);
    aggregate.mockResolvedValue(emptyOverall);

    await service.board({ pipeline: 'Lead Pipeline' });

    const args = (groupBy.mock.calls as unknown[][])[0][0] as {
      where: { AND: Record<string, unknown>[] };
    };
    expect(args.where.AND).toContainEqual({
      deletedAt: null,
      assignments: { some: { userId: 'u1' } },
    });
  });
});

describe('LeadsBoardService.moveStage', () => {
  it('updates the stage and returns the source + target columns recounted (AC1/AC3)', async () => {
    const { service, findFirst, update, groupBy } = makeService();
    findFirst.mockResolvedValue({ status: 'New', pipeline: 'Lead Pipeline' });
    update.mockResolvedValue(listRow({ status: 'HOT' }));
    groupBy.mockResolvedValue([
      { status: 'New', _count: 5, _sum: { actualAmount: dec('500') } },
      { status: 'HOT', _count: 10, _sum: { actualAmount: dec('1200') } },
    ]);

    const res = await service.moveStage(LEAD_ID, { stage: 'HOT' });

    // Writes the shared status field (AC1), scoped to the one lead.
    const args = (update.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(args.where.id).toBe(LEAD_ID);
    expect(args.data.status).toBe('HOT');

    expect(res.lead.status).toBe('HOT');
    expect(res.pipeline).toBe('Lead Pipeline');
    // Source first, then target — both recounted (AC3).
    expect(res.stages).toEqual([
      { stage: 'New', count: 5, totalValue: '500' },
      { stage: 'HOT', count: 10, totalValue: '1200' },
    ]);
  });

  it('404s and never updates a lead outside the caller scope (AC5)', async () => {
    const { service, findFirst, update } = makeService(UserRole.SALES_AGENT);
    findFirst.mockResolvedValue(null);

    await expect(
      service.moveStage(LEAD_ID, { stage: 'HOT' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('400s a move to a stage not in the lead’s pipeline catalogue (AC4)', async () => {
    const { service, findFirst, update, exists } = makeService();
    findFirst.mockResolvedValue({ status: 'New', pipeline: 'Lead Pipeline' });
    exists.mockResolvedValue(false); // target is not a known stage

    await expect(
      service.moveStage(LEAD_ID, { stage: 'Nonsense' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(exists).toHaveBeenCalledWith('Lead Pipeline', 'Nonsense');
    expect(update).not.toHaveBeenCalled();
  });

  it('backfills a source column the move emptied to a zeroed count (AC3)', async () => {
    const { service, findFirst, update, groupBy } = makeService();
    findFirst.mockResolvedValue({ status: 'New', pipeline: 'Lead Pipeline' });
    update.mockResolvedValue(listRow({ status: 'HOT' }));
    // The last New lead moved out, so groupBy no longer returns a New row.
    groupBy.mockResolvedValue([
      { status: 'HOT', _count: 11, _sum: { actualAmount: dec('1300') } },
    ]);

    const res = await service.moveStage(LEAD_ID, { stage: 'HOT' });

    expect(res.stages).toEqual([
      { stage: 'New', count: 0, totalValue: '0' },
      { stage: 'HOT', count: 11, totalValue: '1300' },
    ]);
  });

  it('recounts within the lead’s own pipeline and the caller scope (AC3/AC5)', async () => {
    const { service, findFirst, update, groupBy } = makeService(
      UserRole.SALES_AGENT,
    );
    findFirst.mockResolvedValue({ status: 'New', pipeline: 'LOGISTICS' });
    update.mockResolvedValue(listRow({ status: 'HOT', pipeline: 'LOGISTICS' }));
    groupBy.mockResolvedValue([]);

    await service.moveStage(LEAD_ID, { stage: 'HOT' });

    const args = (groupBy.mock.calls as unknown[][])[0][0] as {
      where: { AND: Record<string, unknown>[] };
    };
    // The move stays on the lead's board, only touches its two columns, and can
    // never see past the agent's own assignments.
    expect(args.where.AND).toContainEqual({ pipeline: 'LOGISTICS' });
    expect(args.where.AND).toContainEqual({ status: { in: ['New', 'HOT'] } });
    expect(args.where.AND).toContainEqual({
      deletedAt: null,
      assignments: { some: { userId: 'u1' } },
    });
  });

  it('recounts a single column when the card is dropped on its own stage', async () => {
    const { service, findFirst, update, groupBy } = makeService();
    findFirst.mockResolvedValue({ status: 'HOT', pipeline: 'Lead Pipeline' });
    update.mockResolvedValue(listRow({ status: 'HOT' }));
    groupBy.mockResolvedValue([
      { status: 'HOT', _count: 10, _sum: { actualAmount: dec('1200') } },
    ]);

    const res = await service.moveStage(LEAD_ID, { stage: 'HOT' });

    // Source and target are the same stage — deduped to one recounted column.
    expect(res.stages).toEqual([
      { stage: 'HOT', count: 10, totalValue: '1200' },
    ]);
    const args = (groupBy.mock.calls as unknown[][])[0][0] as {
      where: { AND: Record<string, unknown>[] };
    };
    expect(args.where.AND).toContainEqual({ status: { in: ['HOT'] } });
  });

  /*
    A board drag writes the same `status` field as the row action (status and stage are
    one field, LEAD-01.1 AC3), so it is one STATUS_CHANGED event, told apart by source.
  */
  it('records the drag as a status change with the stage it left (ADR-0083)', async () => {
    const {
      service,
      findFirst,
      update,
      groupBy,
      auditFindMany,
      auditCreateMany,
    } = makeService();
    findFirst.mockResolvedValue({ status: 'HOT', pipeline: 'Lead Pipeline' });
    update.mockResolvedValue(listRow({ status: 'LOST' }));
    groupBy.mockResolvedValue([]);
    auditFindMany
      .mockResolvedValueOnce([auditRow()])
      .mockResolvedValueOnce([
        auditRow({ status: 'LOST', lostReason: 'Price' }),
      ]);

    await service.moveStage(LEAD_ID, { stage: 'LOST', lostReason: 'Price' });

    const [data] = (
      auditCreateMany.mock.calls[0] as [{ data: Record<string, unknown>[] }]
    ).map((args) => args.data);
    expect(data).toEqual([
      expect.objectContaining({
        entityId: LEAD_ID,
        action: 'STATUS_CHANGED',
        actorId: 'u1',
        source: 'leads.stage',
        before: { status: 'HOT', lostReason: null },
        after: { status: 'LOST', lostReason: 'Price' },
      }),
    ]);
  });

  /*
    A drag onto the WON column converts the lead, exactly as the row action does — the board
    is the one path that checks the target against the stage catalogue first (ADR-0085 A2
    path 4). Pinned because a Logistics order will follow this event.
  */
  it('records a drag onto WON as CONVERTED (ADR-0083)', async () => {
    const {
      service,
      findFirst,
      update,
      groupBy,
      auditFindMany,
      auditCreateMany,
    } = makeService();
    findFirst.mockResolvedValue({ status: 'HOT', pipeline: 'Lead Pipeline' });
    update.mockResolvedValue(listRow({ status: 'WON' }));
    groupBy.mockResolvedValue([]);
    auditFindMany
      .mockResolvedValueOnce([auditRow({ status: 'HOT' })])
      .mockResolvedValueOnce([auditRow({ status: 'WON' })]);

    await service.moveStage(LEAD_ID, { stage: 'WON' });

    const [data] = (
      auditCreateMany.mock.calls[0] as [{ data: Record<string, unknown>[] }]
    ).map((args) => args.data);
    // The drag converts: the CONVERTED event names the order the same transaction created,
    // and the order's own CREATED event follows it (ADR-0085 B14).
    expect(data).toEqual([
      expect.objectContaining({
        action: 'CONVERTED',
        source: 'leads.stage',
        before: { status: 'HOT' },
        after: { status: 'WON' },
        metadata: { orderId: 'order-1' },
      }),
      expect.objectContaining({
        entityType: 'LOGISTICS_ORDER',
        action: 'CREATED',
        leadId: LEAD_ID,
      }),
    ]);
  });

  it('writes no event when the move is refused before any write', async () => {
    const { service, findFirst, exists, auditCreateMany } = makeService();
    findFirst.mockResolvedValue({ status: 'HOT', pipeline: 'Lead Pipeline' });
    exists.mockResolvedValue(false);

    await expect(
      service.moveStage(LEAD_ID, { stage: 'Nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});
