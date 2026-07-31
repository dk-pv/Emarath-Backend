import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { authContext } from './auth-context';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';

function makeGuard(opts: { isPublic?: boolean; verify?: jest.Mock } = {}) {
  const getAllAndOverride = jest.fn().mockReturnValue(opts.isPublic ?? false);
  const verifyAsync = opts.verify ?? jest.fn();
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const jwt = { verifyAsync } as unknown as JwtService;
  return { guard: new JwtAuthGuard(jwt, reflector), verifyAsync };
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
    const { guard, verifyAsync } = makeGuard({ isPublic: true });
    const { context } = ctx();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a protected route with no token (AC1)', async () => {
    const { guard } = makeGuard({ isPublic: false });
    const { context } = ctx({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an invalid/expired/tampered token (AC4)', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('bad signature'));
    const { guard } = makeGuard({ isPublic: false, verify });
    const { context } = ctx({ access_token: 'x.y.z' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a valid token and attaches { id, role } to request + store (AC2)', async () => {
    const verify = jest.fn().mockResolvedValue({
      sub: 'user-1',
      role: UserRole.SALES_AGENT,
    });
    const { guard, verifyAsync } = makeGuard({ isPublic: false, verify });
    const { context, request } = ctx({ access_token: 'good' });

    const storeUser = await authContext.run({}, async () => {
      const ok = await guard.canActivate(context);
      expect(ok).toBe(true);
      return authContext.getStore()?.user;
    });

    // A token without a team claim (pre-AUTH-02.1) resolves team to null.
    expect(request.user).toEqual({
      id: 'user-1',
      role: UserRole.SALES_AGENT,
      team: null,
    });
    expect(storeUser).toEqual({
      id: 'user-1',
      role: UserRole.SALES_AGENT,
      team: null,
    });
    expect(verifyAsync).toHaveBeenCalledWith('good', {
      issuer: 'emarath-api',
      audience: 'emarath-app',
    });
  });

  it("carries the token's team claim onto the resolved user (AUTH-02.1)", async () => {
    const verify = jest.fn().mockResolvedValue({
      sub: 'mgr-1',
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    });
    const { guard } = makeGuard({ isPublic: false, verify });
    const { context, request } = ctx({ access_token: 'good' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'mgr-1',
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    });
  });

  it('rejects a well-signed token missing the sub/role claims', async () => {
    const verify = jest.fn().mockResolvedValue({ sub: 'user-1' });
    const { guard } = makeGuard({ isPublic: false, verify });
    const { context } = ctx({ access_token: 'good' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
