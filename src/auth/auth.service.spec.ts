import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { RefreshTokenService } from './refresh-token.service';
import { UserRole } from '../generated/prisma/client';

const PASSWORD = 'Correct-horse-1';
const HASH = bcrypt.hashSync(PASSWORD, 10);
const USER_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Emarath Admin',
  email: 'admin@emarath.local',
  role: UserRole.SUPERADMIN,
  isActive: true,
  passwordHash: HASH,
};

function makeService(row: typeof USER_ROW | null) {
  const findFirst = jest.fn().mockResolvedValue(row);
  const signAsync = jest.fn().mockResolvedValue('signed.jwt.token');
  const issue = jest.fn().mockResolvedValue('raw-refresh-token');
  const verify = jest.fn();
  const rotate = jest.fn().mockResolvedValue('rotated-refresh-token');
  const revokeFamily = jest.fn().mockResolvedValue(undefined);
  const revokeByRawToken = jest.fn().mockResolvedValue(undefined);
  const prisma = { user: { findFirst } } as unknown as PrismaService;
  const jwt = { signAsync } as unknown as JwtService;
  const refreshTokens = {
    issue,
    verify,
    rotate,
    revokeFamily,
    revokeByRawToken,
  } as unknown as RefreshTokenService;
  return {
    service: new AuthService(prisma, jwt, refreshTokens),
    findFirst,
    signAsync,
    issue,
    verify,
    rotate,
    revokeFamily,
    revokeByRawToken,
  };
}

const dto = (over: Partial<{ email: string; password: string }> = {}) => ({
  email: 'admin@emarath.local',
  password: PASSWORD,
  ...over,
});

describe('AuthService.login (AUTH-01.2/01.3)', () => {
  it('issues an access token AND a refresh token with the basic profile, no hash (AC1/AC5)', async () => {
    const { service, signAsync, issue } = makeService(USER_ROW);
    const result = await service.login(dto(), 'jest-agent');

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.refreshToken).toBe('raw-refresh-token');
    expect(result.user).toEqual({
      id: USER_ROW.id,
      name: USER_ROW.name,
      email: USER_ROW.email,
      role: UserRole.SUPERADMIN,
    });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(signAsync).toHaveBeenCalledWith({
      sub: USER_ROW.id,
      role: UserRole.SUPERADMIN,
    });
    // A new family (undefined familyId) — this device's session.
    expect(issue).toHaveBeenCalledWith(USER_ROW.id, undefined, 'jest-agent');
  });

  it('rejects a wrong password with a generic error and issues no tokens (AC2)', async () => {
    const { service, signAsync, issue } = makeService(USER_ROW);
    await expect(service.login(dto({ password: 'wrong' }))).rejects.toThrow(
      new UnauthorizedException('Invalid email or password.'),
    );
    expect(signAsync).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it('rejects an unknown email with the same generic error (AC2, no enumeration)', async () => {
    const { service } = makeService(null);
    await expect(
      service.login(dto({ email: 'nobody@emarath.local' })),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password.'));
  });

  it('rejects a disabled account with the same generic error (AC4)', async () => {
    const { service } = makeService({ ...USER_ROW, isActive: false });
    await expect(service.login(dto())).rejects.toThrow(
      new UnauthorizedException('Invalid email or password.'),
    );
  });
});

describe('AuthService.refresh (AUTH-01.3)', () => {
  const PUBLIC = {
    id: USER_ROW.id,
    name: USER_ROW.name,
    email: USER_ROW.email,
    role: USER_ROW.role,
  };

  it('rotates the refresh token and mints a fresh access token (AC3)', async () => {
    const { service, findFirst, verify, rotate, signAsync } =
      makeService(USER_ROW);
    verify.mockResolvedValue({
      id: 'tok1',
      userId: USER_ROW.id,
      familyId: 'fam1',
    });
    findFirst.mockResolvedValue(PUBLIC);

    const result = await service.refresh('raw', 'jest-agent');

    expect(verify).toHaveBeenCalledWith('raw');
    expect(rotate).toHaveBeenCalledWith(
      { id: 'tok1', userId: USER_ROW.id, familyId: 'fam1' },
      'jest-agent',
    );
    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.refreshToken).toBe('rotated-refresh-token');
    expect(result.user).toEqual(PUBLIC);
    expect(signAsync).toHaveBeenCalledWith({
      sub: USER_ROW.id,
      role: USER_ROW.role,
    });
  });

  it('propagates rejection of an invalid/expired/reused token (AC4)', async () => {
    const { service, verify, rotate } = makeService(USER_ROW);
    verify.mockRejectedValue(new UnauthorizedException('Invalid session.'));

    await expect(service.refresh('bad')).rejects.toThrow(
      new UnauthorizedException('Invalid session.'),
    );
    expect(rotate).not.toHaveBeenCalled();
  });

  it('revokes the family and refuses to rotate when the user is gone/disabled', async () => {
    const { service, findFirst, verify, rotate, revokeFamily } =
      makeService(USER_ROW);
    verify.mockResolvedValue({
      id: 'tok1',
      userId: USER_ROW.id,
      familyId: 'fam1',
    });
    findFirst.mockResolvedValue(null); // disabled or deleted since issue

    await expect(service.refresh('raw')).rejects.toThrow(
      new UnauthorizedException('Invalid session.'),
    );
    expect(revokeFamily).toHaveBeenCalledWith('fam1');
    expect(rotate).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout (AUTH-01.5)', () => {
  it('revokes the presented token’s family (AC1/AC4)', async () => {
    const { service, revokeByRawToken } = makeService(USER_ROW);
    await service.logout('raw-refresh');
    expect(revokeByRawToken).toHaveBeenCalledWith('raw-refresh');
  });

  it('is a no-op when no token is presented (idempotent, never fails)', async () => {
    const { service, revokeByRawToken } = makeService(USER_ROW);
    await expect(service.logout(undefined)).resolves.toBeUndefined();
    expect(revokeByRawToken).not.toHaveBeenCalled();
  });
});
