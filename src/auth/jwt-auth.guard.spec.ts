import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { TokenExpiredError } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { authContext } from './auth-context';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

const USER_ID = '0b8a4c56-3d1e-4f2a-9b7c-5e6d7f8a9b0c';
const MANAGER_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

function makeGuard(
  opts: { isPublic?: boolean; verify?: jest.Mock; findFirst?: jest.Mock } = {},
) {
  const getAllAndOverride = jest.fn().mockReturnValue(opts.isPublic ?? false);
  const verifyAsync = opts.verify ?? jest.fn();
  const findFirst =
    opts.findFirst ?? jest.fn().mockResolvedValue({ id: USER_ID });
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const jwt = { verifyAsync } as unknown as JwtService;
  const prisma = { user: { findFirst } } as unknown as PrismaService;
  return {
    guard: new JwtAuthGuard(jwt, reflector, prisma),
    verifyAsync,
    findFirst,
  };
}

function ctx(cookies: Record<string, string> = {}) {
  const request: { cookies: Record<string, string>; user?: CurrentUser } = {
    cookies,
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard (AUTH-01.4)', () => {
  it('allows a @Public() route without a token', async () => {
    const { guard, verifyAsync, findFirst } = makeGuard({ isPublic: true });
    const { context } = ctx();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects a protected route with no token (AC1)', async () => {
    const { guard, findFirst } = makeGuard({ isPublic: false });
    const { context } = ctx({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects an invalid/expired/tampered token (AC4)', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('bad signature'));
    const { guard, findFirst } = makeGuard({ isPublic: false, verify });
    const { context } = ctx({ access_token: 'x.y.z' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects an expired token before looking the account up', async () => {
    const verify = jest
      .fn()
      .mockRejectedValue(new TokenExpiredError('jwt expired', new Date(0)));
    const { guard, findFirst } = makeGuard({ isPublic: false, verify });
    const { context, request } = ctx({ access_token: 'old' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired session.',
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it('accepts a valid token and attaches { id, role } to request + store (AC2)', async () => {
    const verify = jest.fn().mockResolvedValue({
      sub: USER_ID,
      role: UserRole.SALES_AGENT,
    });
    const { guard, verifyAsync, findFirst } = makeGuard({
      isPublic: false,
      verify,
    });
    const { context, request } = ctx({ access_token: 'good' });

    const storeUser = await authContext.run({}, async () => {
      const ok = await guard.canActivate(context);
      expect(ok).toBe(true);
      return authContext.getStore()?.user;
    });

    // A token without a team claim (pre-AUTH-02.1) resolves team to null.
    expect(request.user).toEqual({
      id: USER_ID,
      role: UserRole.SALES_AGENT,
      team: null,
    });
    expect(storeUser).toEqual({
      id: USER_ID,
      role: UserRole.SALES_AGENT,
      team: null,
    });
    expect(verifyAsync).toHaveBeenCalledWith('good', {
      issuer: 'emarath-api',
      audience: 'emarath-app',
    });
    // An absent claim must still filter on "no team": undefined would drop the condition.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ team: null }) as object,
      }),
    );
  });

  it("carries the token's team claim onto the resolved user (AUTH-02.1)", async () => {
    const verify = jest.fn().mockResolvedValue({
      sub: MANAGER_ID,
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    });
    const { guard } = makeGuard({ isPublic: false, verify });
    const { context, request } = ctx({ access_token: 'good' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: MANAGER_ID,
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    });
  });

  it('rejects a well-signed token missing the sub/role claims', async () => {
    const verify = jest.fn().mockResolvedValue({ sub: USER_ID });
    const { guard } = makeGuard({ isPublic: false, verify });
    const { context } = ctx({ access_token: 'good' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('the account behind the token (SEC-04)', () => {
    const claims = {
      sub: MANAGER_ID,
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    };

    it('looks up a live account that still has the claimed role and team', async () => {
      const verify = jest.fn().mockResolvedValue(claims);
      const { guard, findFirst } = makeGuard({ isPublic: false, verify });
      const { context } = ctx({ access_token: 'good' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          id: MANAGER_ID,
          role: UserRole.SALES_MANAGER,
          team: 'Sales',
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
    });

    it('requires no team on the account when the token carries none', async () => {
      const verify = jest.fn().mockResolvedValue({
        sub: USER_ID,
        role: UserRole.SALES_AGENT,
        team: null,
      });
      const { guard, findFirst } = makeGuard({ isPublic: false, verify });
      await guard.canActivate(ctx({ access_token: 'good' }).context);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ team: null }) as object,
        }),
      );
    });

    // Deleted, deactivated, unknown, or since given another role or team: the lookup's filter
    // matches none of them, so each is the same no-row answer.
    it('rejects the token when no live account matches it, and attaches nobody', async () => {
      const verify = jest.fn().mockResolvedValue(claims);
      const findFirst = jest.fn().mockResolvedValue(null);
      const { guard } = makeGuard({ isPublic: false, verify, findFirst });
      const { context, request } = ctx({ access_token: 'good' });

      const storeUser = await authContext.run({}, async () => {
        await expect(guard.canActivate(context)).rejects.toThrow(
          new UnauthorizedException('Invalid session.'),
        );
        return authContext.getStore()?.user;
      });
      expect(request.user).toBeUndefined();
      expect(storeUser).toBeUndefined();
    });

    it('refuses a token on the request after its account is deactivated', async () => {
      const verify = jest.fn().mockResolvedValue(claims);
      const findFirst = jest
        .fn()
        .mockResolvedValueOnce({ id: MANAGER_ID })
        .mockResolvedValueOnce(null);
      const { guard } = makeGuard({ isPublic: false, verify, findFirst });

      await expect(
        guard.canActivate(ctx({ access_token: 'same' }).context),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(ctx({ access_token: 'same' }).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(findFirst).toHaveBeenCalledTimes(2);
    });

    it('fails closed when the lookup fails', async () => {
      const verify = jest.fn().mockResolvedValue(claims);
      const outage = new Error('database unreachable');
      const findFirst = jest.fn().mockRejectedValue(outage);
      const { guard } = makeGuard({ isPublic: false, verify, findFirst });
      const { context, request } = ctx({ access_token: 'good' });

      await expect(guard.canActivate(context)).rejects.toBe(outage);
      expect(request.user).toBeUndefined();
    });

    it.each([
      ['an id that is not a UUID', { ...claims, sub: 'user-1' }],
      ['a role that does not exist', { ...claims, role: 'OWNER' }],
      ['a role that is not a string', { ...claims, role: { not: 'QC' } }],
      ['a team that is not a string', { ...claims, team: { not: 'Sales' } }],
    ])(
      'rejects a signed token with %s before it reaches the query',
      async (_label, payload) => {
        const verify = jest.fn().mockResolvedValue(payload);
        const { guard, findFirst } = makeGuard({ isPublic: false, verify });
        await expect(
          guard.canActivate(ctx({ access_token: 'odd' }).context),
        ).rejects.toThrow(new UnauthorizedException('Invalid session.'));
        expect(findFirst).not.toHaveBeenCalled();
      },
    );
  });
});
