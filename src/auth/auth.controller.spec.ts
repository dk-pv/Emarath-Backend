import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRole } from '../generated/prisma/client';

const SESSION = {
  accessToken: 'access.jwt',
  refreshToken: 'raw-refresh',
  user: {
    id: 'u1',
    name: 'Admin',
    email: 'admin@emarath.local',
    role: UserRole.SUPERADMIN,
  },
};

function makeController() {
  const login = jest.fn().mockResolvedValue(SESSION);
  const refresh = jest.fn().mockResolvedValue(SESSION);
  const logout = jest.fn().mockResolvedValue(undefined);
  const auth = { login, refresh, logout } as unknown as AuthService;
  const config = {
    getOrThrow: (ns: string) =>
      ns === 'auth'
        ? {
            cookieSecure: false,
            cookieSameSite: 'lax',
            jwtAccessTtlSec: 900,
            refreshTtlSec: 604800,
          }
        : { apiPrefix: 'api' },
  } as unknown as ConfigService;
  return {
    controller: new AuthController(auth, config),
    login,
    refresh,
    logout,
  };
}

function fakeReq(cookies: Record<string, string> = {}): Request {
  return {
    headers: { 'user-agent': 'jest' },
    cookies,
  } as unknown as Request;
}

function fakeRes() {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const res = { cookie, clearCookie } as unknown as Response;
  const cookieByName = (name: string) =>
    (cookie.mock.calls as [string, string, Record<string, unknown>][]).find(
      (c) => c[0] === name,
    );
  const clearedByName = (name: string) =>
    (clearCookie.mock.calls as [string, Record<string, unknown>][]).find(
      (c) => c[0] === name,
    );
  return { res, cookie, clearCookie, cookieByName, clearedByName };
}

describe('AuthController (AUTH-01.2/01.3)', () => {
  it('login sets HttpOnly access + refresh cookies and returns only the profile', async () => {
    const { controller } = makeController();
    const { res, cookieByName } = fakeRes();

    const body = await controller.login(
      { email: 'admin@emarath.local', password: 'x' },
      fakeReq(),
      res,
    );

    expect(body).toEqual({ user: SESSION.user });
    expect(JSON.stringify(body)).not.toContain('raw-refresh');
    expect(JSON.stringify(body)).not.toContain('access.jwt');

    const access = cookieByName('access_token')!;
    expect(access[1]).toBe('access.jwt');
    expect(access[2].httpOnly).toBe(true);
    expect(access[2].path).toBe('/api');

    const refresh = cookieByName('refresh_token')!;
    expect(refresh[1]).toBe('raw-refresh');
    expect(refresh[2].httpOnly).toBe(true);
    // Refresh cookie is scoped to the auth routes only.
    expect(refresh[2].path).toBe('/api/auth');
    expect(refresh[2].maxAge).toBe(604800 * 1000);
  });

  it('refresh reads the refresh cookie, re-sets both cookies, returns the profile', async () => {
    const { controller, refresh } = makeController();
    const { res, cookieByName } = fakeRes();

    const body = await controller.refresh(
      fakeReq({ refresh_token: 'raw-refresh' }),
      res,
    );

    expect(refresh).toHaveBeenCalledWith('raw-refresh', 'jest');
    expect(body).toEqual({ user: SESSION.user });
    expect(cookieByName('access_token')).toBeDefined();
    expect(cookieByName('refresh_token')).toBeDefined();
  });

  it('refresh rejects a request with no refresh cookie (AC4)', async () => {
    const { controller, refresh } = makeController();
    const { res } = fakeRes();

    await expect(controller.refresh(fakeReq(), res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('AuthController.logout (AUTH-01.5)', () => {
  it('revokes the presented refresh token and clears both cookies (AC1/AC2)', async () => {
    const { controller, logout } = makeController();
    const { res, clearedByName } = fakeRes();

    const body = await controller.logout(
      fakeReq({ refresh_token: 'raw-refresh' }),
      res,
    );

    expect(logout).toHaveBeenCalledWith('raw-refresh');
    expect(body).toEqual({ success: true });

    const access = clearedByName('access_token')!;
    expect(access[1].path).toBe('/api');
    expect(access[1].httpOnly).toBe(true);
    const refresh = clearedByName('refresh_token')!;
    // Path must match login so the browser actually drops the cookie.
    expect(refresh[1].path).toBe('/api/auth');
  });

  it('succeeds with no cookies present and revokes nothing (idempotent)', async () => {
    const { controller, logout } = makeController();
    const { res, clearedByName } = fakeRes();

    const body = await controller.logout(fakeReq(), res);

    expect(body).toEqual({ success: true });
    expect(logout).toHaveBeenCalledWith(undefined);
    expect(clearedByName('access_token')).toBeDefined();
    expect(clearedByName('refresh_token')).toBeDefined();
  });

  it('called twice never fails', async () => {
    const { controller } = makeController();
    const { res } = fakeRes();
    await expect(
      controller.logout(fakeReq({ refresh_token: 'raw-refresh' }), res),
    ).resolves.toEqual({ success: true });
    await expect(
      controller.logout(fakeReq({ refresh_token: 'raw-refresh' }), res),
    ).resolves.toEqual({ success: true });
  });
});
