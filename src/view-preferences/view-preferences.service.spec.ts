import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ViewPreferencesService } from './view-preferences.service';

function makeService(userId = 'u1') {
  // Held as locals so assertions never reference an unbound class method, the
  // pattern the leads specs use.
  const findUnique = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);

  const prisma = {
    userViewPreference: { findUnique, upsert },
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: userId, role: UserRole.SALES_AGENT }),
  } as unknown as CurrentUserService;

  const service = new ViewPreferencesService(prisma, currentUser);
  return { service, findUnique, upsert };
}

describe('ViewPreferencesService.get', () => {
  it('returns null when the user has saved no layout', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    expect(await service.get('leads')).toEqual({ layout: null });
  });

  it('returns the saved layout scoped to the caller', async () => {
    const { service, findUnique } = makeService('u1');
    findUnique.mockResolvedValue({
      layout: { order: ['source', 'status'], hidden: ['status'] },
    });

    expect(await service.get('leads')).toEqual({
      layout: { order: ['source', 'status'], hidden: ['status'] },
    });
    const where = (findUnique.mock.calls as unknown[][])[0][0] as {
      where: { userId_viewKey: { userId: string; viewKey: string } };
    };
    expect(where.where.userId_viewKey).toEqual({
      userId: 'u1',
      viewKey: 'leads',
    });
  });

  it('treats a malformed stored layout as no layout', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ layout: { order: 'nope', hidden: [1] } });

    expect(await service.get('leads')).toEqual({ layout: null });
  });

  it('rejects an invalid view key', async () => {
    const { service } = makeService();
    await expect(service.get('Not Valid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ViewPreferencesService.save', () => {
  it('upserts the layout for the caller and echoes it back', async () => {
    const { service, upsert } = makeService('u9');
    const layout = { order: ['source', 'status'], hidden: ['status'] };

    expect(await service.save('leads', layout)).toEqual({ layout });

    const args = (upsert.mock.calls as unknown[][])[0][0] as {
      where: { userId_viewKey: { userId: string; viewKey: string } };
      create: { viewKey: string; layout: unknown };
      update: { layout: unknown };
    };
    expect(args.where.userId_viewKey).toEqual({
      userId: 'u9',
      viewKey: 'leads',
    });
    expect(args.create.layout).toEqual(layout);
    expect(args.update.layout).toEqual(layout);
  });

  it('rejects an invalid view key before writing', async () => {
    const { service, upsert } = makeService();
    await expect(
      service.save('../etc', { order: [], hidden: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
