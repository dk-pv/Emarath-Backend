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
    ...overrides,
  };
}

function makeService() {
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const del = jest.fn();
  const leadUpdateMany = jest.fn();
  const leadCount = jest.fn();
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const $transaction = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));

  const prisma = {
    stage: { findMany, findUnique, findFirst, create, update, delete: del },
    lead: { updateMany: leadUpdateMany, count: leadCount },
    auditEvent: { createMany: auditCreateMany },
    $transaction,
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'admin-1', role: 'SUPERADMIN' }),
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
    $transaction,
  };
}

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
    expect($transaction).not.toHaveBeenCalled();
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

    const [batch] = $transaction.mock.calls[0] as [unknown[]];
    expect(batch).toHaveLength(3);
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

  it('records nothing for a recolour, which moves no lead', async () => {
    const { service, findUnique, update, auditCreateMany } = makeService();
    findUnique.mockResolvedValue({ id: 'id', pipeline: PIPELINE, name: 'HOT' });
    update.mockResolvedValue(stageRow({ color: 'red' }));

    await service.update('id', { color: 'red' });

    expect(auditCreateMany).not.toHaveBeenCalled();
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
    expect(del).toHaveBeenCalledWith({ where: { id: 'id' } });
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
