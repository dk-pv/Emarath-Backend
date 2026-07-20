import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LookupsService } from './lookups.service';

describe('LookupsService', () => {
  const findMany = jest.fn();
  const prisma = { tag: { findMany } } as unknown as PrismaService;
  const service = new LookupsService(prisma);

  beforeEach(() => findMany.mockReset());

  it('returns a config list as {value,label} pairs', async () => {
    const languages = await service.byType('languages');
    expect(languages).toEqual(
      expect.arrayContaining([{ value: 'English', label: 'English' }]),
    );
    expect(languages.length).toBeGreaterThan(0);
  });

  it('serves the pipeline options including the default (ADR-0005)', async () => {
    const pipelines = await service.byType('pipelines');
    expect(pipelines.map((option) => option.value)).toEqual([
      'Lead Pipeline',
      'Complaints',
      'LOGISTICS',
      'QC',
    ]);
  });

  it('exposes attempt counts as strings 0..4', async () => {
    const counts = await service.byType('attemptCounts');
    expect(counts.map((option) => option.value)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  it('rejects an unknown lookup type', async () => {
    await expect(service.byType('nonsense')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads tags from the database as {value:id,label:name}', async () => {
    findMany.mockResolvedValue([{ id: 'tag-1', name: 'VIP' }]);
    const tags = await service.byType('tags');
    expect(tags).toEqual([{ value: 'tag-1', label: 'VIP' }]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});
