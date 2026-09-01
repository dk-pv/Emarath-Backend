import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from './integrations.service';

const ID = '11111111-1111-1111-1111-111111111111';

function integrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    key: 'facebook',
    name: 'Facebook',
    description: 'Connect Facebook to capture leads, manage campaigns',
    category: 'Meta',
    logo: 'IconBrandFacebook',
    enabled: false,
    detailUrl: null,
    position: 1,
    ...overrides,
  };
}

function makeService() {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();

  const prisma = {
    integration: { findMany, findFirst, update },
  } as unknown as PrismaService;

  return {
    service: new IntegrationsService(prisma),
    findMany,
    findFirst,
    update,
  };
}

describe('IntegrationsService.list', () => {
  it('returns the registry in grid order, excluding soft-deleted rows (AC1/AC2)', async () => {
    const { service, findMany } = makeService();
    const rows = [
      integrationRow({ position: 1 }),
      integrationRow({
        id: '22222222-2222-2222-2222-222222222222',
        key: 'web-form',
        position: 2,
      }),
    ];
    findMany.mockResolvedValue(rows);

    await expect(service.list()).resolves.toEqual(rows);

    const args = (findMany.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
    };
    expect(args.where).toEqual({ deletedAt: null });
    expect(args.orderBy).toEqual({ position: 'asc' });
  });

  it('selects the detail link and category the library card needs (AC1/AC3)', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([]);

    await service.list();

    const args = (findMany.mock.calls as unknown[][])[0][0] as {
      select: Record<string, boolean>;
    };
    expect(args.select).toMatchObject({
      key: true,
      name: true,
      description: true,
      category: true,
      logo: true,
      enabled: true,
      detailUrl: true,
      position: true,
    });
  });

  it('returns an empty library cleanly rather than throwing', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([]);

    await expect(service.list()).resolves.toEqual([]);
  });
});

describe('IntegrationsService.setEnabled', () => {
  it('enables an integration and returns the updated row (INT-02.2 AC1)', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue({ id: ID });
    update.mockResolvedValue(integrationRow({ enabled: true }));

    await expect(service.setEnabled(ID, true)).resolves.toMatchObject({
      enabled: true,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID }, data: { enabled: true } }),
    );
  });

  it('disables an integration through the same path (INT-02.2 AC1)', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue({ id: ID });
    update.mockResolvedValue(integrationRow({ enabled: false }));

    await expect(service.setEnabled(ID, false)).resolves.toMatchObject({
      enabled: false,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { enabled: false } }),
    );
  });

  it('404s an unknown id without writing', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue(null);

    await expect(service.setEnabled(ID, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to toggle a soft-deleted integration (CLAUDE.md §11)', async () => {
    const { service, findFirst, update } = makeService();
    // The lookup filters deletedAt: null, so a retired row resolves to null even
    // though its primary key still exists — the toggle must not resurrect it.
    findFirst.mockResolvedValue(null);

    await expect(service.setEnabled(ID, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const args = (findFirst.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toEqual({ id: ID, deletedAt: null });
    expect(update).not.toHaveBeenCalled();
  });
});
