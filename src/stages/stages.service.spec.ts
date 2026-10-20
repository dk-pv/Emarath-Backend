import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { RESERVED_STAGE_NAMES, StagesService } from './stages.service';

const PIPELINE = 'Lead Pipeline';

function stageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    pipeline: PIPELINE,
    name: 'HOT',
    color: 'amber',
    position: 3,
    isClosed: false,
    outcome: null,
    inclusion: 'INCLUDE_IN_SALES_PIPELINE',
    probability: 0,
    requireFollowUp: false,
    ...overrides,
  };
}

function makeService(
  // Who manages the stages; the admin unless a test says otherwise (ADR-0093).
  user: object = { id: 'admin-1', role: 'SUPERADMIN' },
) {
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const del = jest.fn();
  const leadUpdateMany = jest.fn();
  const leadCount = jest.fn();
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  // The stage as the locked read inside a change's transaction finds it (AUD-03).
  const findUniqueOrThrow = jest.fn().mockResolvedValue(stageRow());
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const pipelineFindUnique = jest.fn().mockResolvedValue({ id: 'pipe-1' });

  const prisma = {
    stage: {
      findMany,
      findUnique,
      findFirst,
      findUniqueOrThrow,
      create,
      update,
      delete: del,
    },
    lead: { updateMany: leadUpdateMany, count: leadCount },
    pipeline: { findUnique: pipelineFindUnique },
    auditEvent: { createMany: auditCreateMany },
    $queryRaw,
  } as unknown as PrismaService;
  // An array runs as a batch; a callback gets the client as its transaction.
  const $transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: PrismaService) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
  Object.assign(prisma, { $transaction });

  const currentUser = {
    resolve: jest.fn().mockResolvedValue(user),
  } as unknown as CurrentUserService;

  const service = new StagesService(prisma, currentUser);
  return {
    service,
    findMany,
    findUnique,
    findFirst,
    create,
    update,
    del,
    leadUpdateMany,
    leadCount,
    auditCreateMany,
    findUniqueOrThrow,
    $queryRaw,
    $transaction,
  };
}

/** The rows the audit write was asked for, in call order. */
const auditRows = (auditCreateMany: jest.Mock) =>
  (
    auditCreateMany.mock.calls as [{ data: Record<string, unknown>[] }][]
  ).flatMap(([args]) => args.data);

describe('StagesService.create', () => {
  it('appends a new stage after the last position (AC1)', async () => {
    const { service, findUnique, findFirst, create } = makeService();
    findUnique.mockResolvedValue(null); // no name clash
    findFirst.mockResolvedValue({ position: 5 }); // current last
    create.mockResolvedValue(stageRow({ name: 'Reorder', position: 6 }));

    const result = await service.create({
      pipeline: PIPELINE,
      name: 'Reorder',
      color: 'violet',
    });

    expect(result.position).toBe(6);
    const args = (create.mock.calls as unknown[][])[0][0] as {
      data: { position: number; pipeline: string };
    };
    expect(args.data.position).toBe(6);
    expect(args.data.pipeline).toBe(PIPELINE);
  });

  it('gives the first stage of an empty pipeline position 0', async () => {
    const { service, findUnique, findFirst, create } = makeService();
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue(stageRow({ position: 0 }));

    await service.create({ pipeline: 'QC', name: 'New', color: 'violet' });

    const args = (create.mock.calls as unknown[][])[0][0] as {
      data: { position: number };
    };
    expect(args.data.position).toBe(0);
  });

  it('rejects a duplicate stage name (AC5)', async () => {
    const { service, findUnique, create } = makeService();
    findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create({ pipeline: PIPELINE, name: 'HOT', color: 'amber' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to create a second WON or QC NOT APPROVED (ADR-0085 B17)', async () => {
    for (const name of ['WON', 'QC NOT APPROVED']) {
      const { service, findUnique, create } = makeService();
      findUnique.mockResolvedValue(null);

      await expect(
        service.create({ pipeline: 'Complaints', name, color: 'lime' }),
      ).rejects.toThrow('is reserved for the Logistics workflow');
      expect(create).not.toHaveBeenCalled();
    }
  });
});

describe('StagesService.update', () => {
  it('recolours a stage without touching any lead (AC2)', async () => {
    const { service, findUnique, update, leadUpdateMany, $transaction } =
      makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'HOT' });
    update.mockResolvedValue(stageRow({ color: 'red' }));

    const result = await service.update('id', { color: 'red' });

    expect(result.color).toBe('red');
    const args = (update.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data).toEqual({ color: 'red' });
    expect(leadUpdateMany).not.toHaveBeenCalled();
    // One transaction: the recolour and its event (AUD-03).
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('renames a stage and cascades to its leads in one transaction (AC2/AC4)', async () => {
    const { service, findUnique, update, leadUpdateMany, $transaction } =
      makeService();
    findUnique
      .mockResolvedValueOnce({ id: 'id', pipeline: PIPELINE, name: 'HOT' }) // the stage
      .mockResolvedValueOnce(null); // no name clash
    update.mockResolvedValue(stageRow({ name: 'Very Hot' }));
    leadUpdateMany.mockResolvedValue({ count: 12 });

    const result = await service.update('id', { name: 'Very Hot' });

    expect(result.name).toBe('Very Hot');
    expect($transaction).toHaveBeenCalledTimes(1);
    const updateArgs = (update.mock.calls as unknown[][])[0][0] as {
      data: { name: string };
    };
    expect(updateArgs.data.name).toBe('Very Hot');
    const cascadeArgs = (leadUpdateMany.mock.calls as unknown[][])[0][0] as {
      where: { status: string; pipeline: string };
      data: { status: string };
    };
    expect(cascadeArgs.where).toEqual({ status: 'HOT', pipeline: PIPELINE });
    expect(cascadeArgs.data).toEqual({ status: 'Very Hot' });
  });

  it('records the rename once, on the stage, inside the rename’s transaction (ADR-0083)', async () => {
    const { service, findUnique, update, auditCreateMany, $transaction } =
      makeService();
    findUnique
      .mockResolvedValueOnce({ id: 'id', pipeline: PIPELINE, name: 'HOT' })
      .mockResolvedValueOnce(null);
    update.mockResolvedValue(stageRow({ name: 'Very Hot' }));

    await service.update('id', { name: 'Very Hot' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(auditCreateMany).toHaveBeenCalledWith({
      data: [
        {
          entityType: 'STAGE',
          entityId: 'id',
          leadId: null,
          action: 'RENAMED',
          actorType: 'USER',
          actorId: 'admin-1',
          source: 'stages.update',
          before: { name: 'HOT' },
          after: { name: 'Very Hot' },
          metadata: { pipeline: PIPELINE },
        },
      ],
    });
  });

  /*
    The one status write no lead-level audit could see (ADR-0085 A2 path 8): a rename relabels
    every lead in the stage through one `updateMany`, outside the per-lead audit and outside the
    conversion hook. Renaming a stage *to* WON would therefore mark a whole column converted
    with no order behind it, so the reserved-name guard refuses it before any lead is touched
    (ADR-0085 B17). Every other rename still cascades exactly as before.
  */
  it('refuses to rename a stage to WON, leaving every lead untouched', async () => {
    const { service, findUnique, update, leadUpdateMany, auditCreateMany } =
      makeService();
    findUnique.mockResolvedValueOnce({
      id: 'id',
      pipeline: PIPELINE,
      name: 'Converted',
    });

    await expect(service.update('id', { name: 'WON' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
    expect(leadUpdateMany).not.toHaveBeenCalled();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('refuses to rename WON or QC NOT APPROVED away', async () => {
    for (const name of RESERVED_STAGE_NAMES) {
      const { service, findUnique, leadUpdateMany } = makeService();
      findUnique.mockResolvedValueOnce({ id: 'id', pipeline: PIPELINE, name });

      await expect(
        service.update('id', { name: 'Something else' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(leadUpdateMany).not.toHaveBeenCalled();
    }
  });

  it('still recolours a reserved stage — only its name is protected', async () => {
    const { service, findUnique, update } = makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'WON' });
    update.mockResolvedValue(stageRow({ name: 'WON', color: 'red' }));

    await expect(service.update('id', { color: 'red' })).resolves.toMatchObject(
      { color: 'red' },
    );
  });

  // AUD-03 reverses the earlier rule: a recolour moves no lead, but it is a configuration change.
  it('records a recolour as one UPDATED with the old and new colour, and no lead event', async () => {
    const { service, findUnique, update, auditCreateMany } = makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'HOT' });
    update.mockResolvedValue(stageRow({ color: 'red' }));

    await service.update('id', { color: 'red' });

    expect(auditRows(auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'STAGE',
        entityId: 'id',
        action: 'UPDATED',
        source: 'stages.update',
        before: { color: 'amber' },
        after: { color: 'red' },
        metadata: { pipeline: PIPELINE },
      }),
    ]);
  });

  it('rejects a rename onto an existing name (AC5)', async () => {
    const { service, findUnique, leadUpdateMany } = makeService();
    findUnique
      .mockResolvedValueOnce({ id: 'id', pipeline: PIPELINE, name: 'HOT' })
      .mockResolvedValueOnce({ id: 'other' }); // name already taken

    await expect(service.update('id', { name: 'WON' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(leadUpdateMany).not.toHaveBeenCalled();
  });

  it('404s an unknown stage', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(
      service.update('missing', { color: 'red' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StagesService.reorder', () => {
  it('persists the given order (AC3)', async () => {
    const { service, findMany, update } = makeService();
    findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) // known ids
      .mockResolvedValueOnce([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ]) // the current order, read under the lock
      .mockResolvedValueOnce([
        stageRow({ id: 'c', position: 0 }),
        stageRow({ id: 'a', position: 1 }),
        stageRow({ id: 'b', position: 2 }),
      ]); // the re-read list
    update.mockResolvedValue(stageRow());

    await service.reorder({ pipeline: PIPELINE, orderedIds: ['c', 'a', 'b'] });

    const positions = (update.mock.calls as unknown[][]).map((call) => {
      const arg = call[0] as {
        where: { id: string };
        data: { position: number };
      };
      return [arg.where.id, arg.data.position];
    });
    expect(positions).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('rejects an order that is not exactly the pipeline’s stages (AC5)', async () => {
    const { service, findMany, update, $transaction } = makeService();
    findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    await expect(
      service.reorder({ pipeline: PIPELINE, orderedIds: ['a', 'b'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('StagesService.remove', () => {
  it('deletes a stage no lead sits in (AC5)', async () => {
    const { service, findUnique, leadCount, del } = makeService();
    findUnique.mockResolvedValue({
      id: 'id',
      pipeline: PIPELINE,
      name: 'Cold',
    });
    leadCount.mockResolvedValue(0);
    del.mockResolvedValue(stageRow());

    const result = await service.remove('id');

    expect(result).toEqual({ id: 'id' });
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'id' } }),
    );
  });

  it('refuses to delete a stage that still holds leads (AC5)', async () => {
    const { service, findUnique, leadCount, del } = makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'HOT' });
    leadCount.mockResolvedValue(7);

    await expect(service.remove('id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it('counts archived leads too, so none is left on a deleted stage (KAN-05.3 AC5)', async () => {
    const { service, findUnique, leadCount, del } = makeService();
    findUnique.mockResolvedValue({
      id: 'id',
      pipeline: PIPELINE,
      name: 'Cold',
    });
    // Every lead in the stage, then the archived ones among them.
    leadCount.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await expect(service.remove('id')).rejects.toThrow(
      'This stage holds 1 lead(s), 1 of them archived; move them before deleting it.',
    );
    expect(leadCount).toHaveBeenCalledWith({
      where: { status: 'Cold', pipeline: PIPELINE },
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('404s an unknown stage', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('StagesService.exists', () => {
  it('is true when the stage is in the pipeline, false otherwise', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValueOnce({ id: 'id' });
    await expect(service.exists(PIPELINE, 'HOT')).resolves.toBe(true);

    findUnique.mockResolvedValueOnce(null);
    await expect(service.exists(PIPELINE, 'Ghost')).resolves.toBe(false);
  });
});

describe('StagesService.remove — reserved stages', () => {
  it('refuses to delete a stage the Logistics workflow depends on', async () => {
    const { service, findUnique, leadCount, del } = makeService();
    findUnique.mockResolvedValue({
      id: 'id',
      pipeline: PIPELINE,
      name: 'QC NOT APPROVED',
    });

    await expect(service.remove('id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Refused before the emptiness check, so an empty reserved stage is protected too.
    expect(leadCount).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

// ADR-0093 B10: stage management needs access to the pipeline; @Roles still decides who.
describe('StagesService — pipeline access (ADR-0093)', () => {
  const manager = {
    id: 'mgr-1',
    role: 'SALES_MANAGER',
    deniedPipelines: ['VIP'],
  };
  const CLOSED = `You don't have access to the "VIP" pipeline.`;

  it('refuses a manager adding, renaming, reordering or deleting stages of a closed pipeline', async () => {
    const { service, findUnique, findMany, create, update, del } =
      makeService(manager);
    findUnique.mockResolvedValue({ id: 's1', pipeline: 'VIP', name: 'Intake' });

    await expect(
      service.create({ pipeline: 'VIP', name: 'Intake', color: 'cyan' }),
    ).rejects.toThrow(CLOSED);
    await expect(service.update('s1', { name: 'Renamed' })).rejects.toThrow(
      CLOSED,
    );
    await expect(
      service.reorder({ pipeline: 'VIP', orderedIds: ['s1'] }),
    ).rejects.toThrow(CLOSED);
    await expect(service.remove('s1')).rejects.toThrow(CLOSED);

    expect(findMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('lets that manager manage the stages of a pipeline open to them', async () => {
    const { service, findUnique, findFirst, create } = makeService(manager);
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 's2' });

    await service.create({
      pipeline: 'Complaints',
      name: 'Intake',
      color: 'cyan',
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('lets the admin manage the stages of any pipeline (B1)', async () => {
    const { service, findUnique, findFirst, create } = makeService({
      ...manager,
      role: 'SUPERADMIN',
    });
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 's3' });

    await service.create({ pipeline: 'VIP', name: 'Intake', color: 'cyan' });

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('StagesService — configuration audit (AUD-03)', () => {
  it('records a new stage as CREATED with its settings, in the create’s own transaction', async () => {
    const {
      service,
      findUnique,
      findFirst,
      create,
      auditCreateMany,
      $transaction,
    } = makeService();
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue({ position: 5 });
    create.mockResolvedValue(
      stageRow({ id: 'new', name: 'Reorder', position: 6 }),
    );

    await service.create({
      pipeline: PIPELINE,
      name: 'Reorder',
      color: 'amber',
    });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(auditRows(auditCreateMany)).toEqual([
      {
        entityType: 'STAGE',
        entityId: 'new',
        leadId: null,
        action: 'CREATED',
        actorType: 'USER',
        actorId: 'admin-1',
        source: 'stages.create',
        before: undefined,
        after: {
          name: 'Reorder',
          color: 'amber',
          position: 6,
          isClosed: false,
          outcome: null,
          inclusion: 'INCLUDE_IN_SALES_PIPELINE',
          probability: 0,
          requireFollowUp: false,
        },
        metadata: { pipeline: PIPELINE },
      },
    ]);
  });

  it('records nothing when the save changes nothing', async () => {
    const { service, findUnique, update, auditCreateMany } = makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'HOT' });
    update.mockResolvedValue(stageRow());

    await service.update('id', { color: 'amber', probability: 0 });

    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('records a rename with a reconfiguration as RENAMED plus one UPDATED', async () => {
    const { service, findUnique, update, auditCreateMany } = makeService();
    findUnique
      .mockResolvedValueOnce({ id: 'id', pipeline: PIPELINE, name: 'HOT' })
      .mockResolvedValueOnce(null);
    update.mockResolvedValue(
      stageRow({ name: 'Very Hot', probability: 60, isClosed: true }),
    );

    await service.update('id', {
      name: 'Very Hot',
      probability: 60,
      isClosed: true,
    });

    expect(
      auditRows(auditCreateMany).map((row) => [
        row.action,
        row.before,
        row.after,
      ]),
    ).toEqual([
      ['RENAMED', { name: 'HOT' }, { name: 'Very Hot' }],
      [
        'UPDATED',
        { isClosed: false, probability: 0 },
        { isClosed: true, probability: 60 },
      ],
    ]);
  });

  it('locks the stage before reading the state it compares against', async () => {
    const { service, findUnique, update, $queryRaw, findUniqueOrThrow } =
      makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'HOT' });
    update.mockResolvedValue(stageRow({ color: 'red' }));

    await service.update('id', { color: 'red' });

    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect($queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('records nothing when the write itself fails — the transaction carries no event', async () => {
    const { service, findUnique, update, auditCreateMany } = makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'HOT' });
    update.mockRejectedValue(new Error('write failed'));

    await expect(service.update('id', { color: 'red' })).rejects.toThrow(
      'write failed',
    );
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('records a reorder once, on the pipeline, as its stage order before and after', async () => {
    const { service, findMany, update, auditCreateMany } = makeService();
    findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      .mockResolvedValueOnce([
        { id: 'a', name: 'New' },
        { id: 'b', name: 'HOT' },
        { id: 'c', name: 'WON' },
      ])
      .mockResolvedValueOnce([]);
    update.mockResolvedValue(stageRow());

    await service.reorder({ pipeline: PIPELINE, orderedIds: ['b', 'a', 'c'] });

    expect(auditRows(auditCreateMany)).toEqual([
      expect.objectContaining({
        entityType: 'PIPELINE',
        entityId: 'pipe-1',
        action: 'UPDATED',
        source: 'stages.reorder',
        before: { stageOrder: ['New', 'HOT', 'WON'] },
        after: { stageOrder: ['HOT', 'New', 'WON'] },
      }),
    ]);
  });

  it('records nothing for a reorder that keeps the current order', async () => {
    const { service, findMany, update, auditCreateMany } = makeService();
    findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([
        { id: 'a', name: 'New' },
        { id: 'b', name: 'HOT' },
      ])
      .mockResolvedValueOnce([]);
    update.mockResolvedValue(stageRow());

    await service.reorder({ pipeline: PIPELINE, orderedIds: ['a', 'b'] });

    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  it('records a delete as DELETED with what the stage was; a refused delete records nothing', async () => {
    const deleted = makeService();
    deleted.findUnique.mockResolvedValue({
      id: 'id',
      pipeline: PIPELINE,
      name: 'Cold',
    });
    deleted.leadCount.mockResolvedValue(0);
    deleted.del.mockResolvedValue(stageRow({ name: 'Cold', color: 'sky' }));

    await deleted.service.remove('id');

    expect(auditRows(deleted.auditCreateMany)).toMatchObject([
      {
        entityType: 'STAGE',
        entityId: 'id',
        action: 'DELETED',
        source: 'stages.delete',
        before: { name: 'Cold', color: 'sky' },
        metadata: { pipeline: PIPELINE },
      },
    ]);

    const refused = makeService();
    refused.findUnique.mockResolvedValue({
      id: 'id',
      pipeline: PIPELINE,
      name: 'HOT',
    });
    refused.leadCount.mockResolvedValue(3);
    await expect(refused.service.remove('id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(refused.auditCreateMany).not.toHaveBeenCalled();
  });

  it('records nothing when a manager is refused a closed pipeline', async () => {
    const { service, findUnique, auditCreateMany } = makeService({
      id: 'mgr-1',
      role: 'SALES_MANAGER',
      deniedPipelines: ['VIP'],
    });
    findUnique.mockResolvedValue({ id: 's1', pipeline: 'VIP', name: 'Intake' });

    await expect(service.update('s1', { color: 'red' })).rejects.toThrow();
    await expect(service.remove('s1')).rejects.toThrow();
    expect(auditCreateMany).not.toHaveBeenCalled();
  });
});
