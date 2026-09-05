import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LookupsService } from './lookups.service';

describe('LookupsService', () => {
  const findMany = jest.fn();
  const pipelineFindMany = jest.fn();
  const leadSourceFindMany = jest.fn();
  const prisma = {
    tag: { findMany },
    pipeline: { findMany: pipelineFindMany },
    leadSource: { findMany: leadSourceFindMany },
  } as unknown as PrismaService;
  const service = new LookupsService(prisma);

  beforeEach(() => {
    findMany.mockReset();
    pipelineFindMany.mockReset();
    leadSourceFindMany.mockReset();
  });

  it('returns a config list as {value,label} pairs', async () => {
    const languages = await service.byType('languages');
    expect(languages).toEqual(
      expect.arrayContaining([{ value: 'English', label: 'English' }]),
    );
    expect(languages.length).toBeGreaterThan(0);
  });

  // Pipelines moved from the config catalogue to the `Pipeline` table (ADR-0059); the
  // lookup now reads what Settings manages, default first, so the two cannot drift.
  it('reads pipelines from the database, default first', async () => {
    pipelineFindMany.mockResolvedValue([
      { name: 'Lead Pipeline' },
      { name: 'Complaints' },
      { name: 'LOGISTICS' },
      { name: 'QC' },
    ]);

    const pipelines = await service.byType('pipelines');

    expect(pipelines.map((option) => option.value)).toEqual([
      'Lead Pipeline',
      'Complaints',
      'LOGISTICS',
      'QC',
    ]);
    const [call] = pipelineFindMany.mock.calls[0] as [{ orderBy: unknown }];
    expect(call.orderBy).toEqual([{ isDefault: 'desc' }, { createdAt: 'asc' }]);
  });

  // Sources moved from the config catalogue to the `LeadSource` table, exactly as
  // pipelines did: the lookup now reads what Settings manages, so the New Lead form's
  // dropdown and the catalogue screen cannot drift apart.
  it('reads lead sources from the database, offering only the active ones', async () => {
    leadSourceFindMany.mockResolvedValue([
      { name: 'Broadcast' },
      { name: 'Website' },
    ]);

    const sources = await service.byType('sources');

    expect(sources).toEqual([
      { value: 'Broadcast', label: 'Broadcast' },
      { value: 'Website', label: 'Website' },
    ]);
    const [call] = leadSourceFindMany.mock.calls[0] as [
      { where: unknown; orderBy: unknown },
    ];
    // A deactivated source stays on its historical leads but is not offered for new ones.
    expect(call.where).toEqual({ isActive: true });
    expect(call.orderBy).toEqual({ name: 'asc' });
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

  // The Tags catalogue gained an Active/Inactive status, so the lookup now narrows to
  // active rows as the category and lead-source lookups do: a retired tag stays on the
  // leads carrying it but is not offered for new assignments.
  it('reads tags from the database as {value:id,label:name}, active only', async () => {
    findMany.mockResolvedValue([{ id: 'tag-1', name: 'VIP' }]);
    const tags = await service.byType('tags');
    expect(tags).toEqual([{ value: 'tag-1', label: 'VIP' }]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, isActive: true } }),
    );
  });
});
