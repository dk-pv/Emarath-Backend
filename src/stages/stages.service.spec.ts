import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StagesService } from './stages.service';

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
  const $transaction = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));

  const prisma = {
    stage: { findMany, findUnique, findFirst, create, update, delete: del },
    lead: { updateMany: leadUpdateMany, count: leadCount },
    $transaction,
  } as unknown as PrismaService;

  const service = new StagesService(prisma);
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
