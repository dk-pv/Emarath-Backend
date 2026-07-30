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
  const auth = { login, refresh } as unknown as AuthService;
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
  return { controller: new AuthController(auth, config), login, refresh };
}

function fakeReq(cookies: Record<string, string> = {}): Request {
  return {
    headers: { 'user-agent': 'jest' },
    cookies,
  } as unknown as Request;
}

function fakeRes() {
  const cookie = jest.fn();
  const res = { cookie } as unknown as Response;
  const cookieByName = (name: string) =>
    (cookie.mock.calls as [string, string, Record<string, unknown>][]).find(
      (c) => c[0] === name,
    );
  return { res, cookie, cookieByName };
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
