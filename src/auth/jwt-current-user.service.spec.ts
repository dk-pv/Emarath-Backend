import { UnauthorizedException } from '@nestjs/common';
import { JwtCurrentUserService } from './jwt-current-user.service';
import { authContext } from './auth-context';
import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

describe('JwtCurrentUserService (AUTH-01.4)', () => {
  const findMany = jest.fn();
  const service = new JwtCurrentUserService({
    pipeline: { findMany },
  } as unknown as PrismaService);

  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  it('resolves the user the guard placed in the request store', async () => {
    const user = { id: 'u1', role: UserRole.SUPERADMIN };
    const resolved = await authContext.run({ user }, () => service.resolve());
    expect(resolved).toEqual(user);
  });

  it('throws when the store holds no user (unauthenticated)', async () => {
    await expect(
      authContext.run({}, () => service.resolve()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when there is no request store at all', async () => {
    await expect(service.resolve()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // ADR-0093: pipeline grants come from the database on each request, never the token.
  describe('pipeline access', () => {
    const agent = { id: 'u2', role: UserRole.SALES_AGENT, team: 'Sales' };

    it('attaches the pipelines closed to a sales caller', async () => {
      findMany.mockResolvedValue([{ name: 'VIP' }]);

      const resolved = await authContext.run({ user: agent }, () =>
        service.resolve(),
      );

      expect(resolved).toEqual({ ...agent, deniedPipelines: ['VIP'] });
    });

    it('reads the grants once per request, however often the request resolves', async () => {
      await authContext.run({ user: agent }, async () => {
        await service.resolve();
        await service.resolve();
      });

      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('reads them again on the next request, so a grant change applies at once', async () => {
      findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: 'VIP' }]);

      const before = await authContext.run({ user: agent }, () =>
        service.resolve(),
      );
      const after = await authContext.run({ user: agent }, () =>
        service.resolve(),
      );

      expect(before.deniedPipelines).toEqual([]);
      expect(after.deniedPipelines).toEqual(['VIP']);
    });

    it.each([UserRole.SUPERADMIN, UserRole.LOGISTICS_MANAGER, UserRole.QC])(
      'reads no grants for %s (the admin bypasses them; operational roles see no lead)',
      async (role) => {
        const user = { id: 'u3', role };

        const resolved = await authContext.run({ user }, () =>
          service.resolve(),
        );

        expect(resolved).toEqual(user);
        expect(findMany).not.toHaveBeenCalled();
      },
    );

    it('fails the request rather than resolving without its grants', async () => {
      findMany.mockRejectedValue(new Error('database unavailable'));

      await expect(
        authContext.run({ user: agent }, () => service.resolve()),
      ).rejects.toThrow('database unavailable');
    });
  });
});
