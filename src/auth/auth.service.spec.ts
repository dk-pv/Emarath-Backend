import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { RefreshTokenService } from './refresh-token.service';
import type { PasswordResetService } from './password-reset.service';
import type { MailerService } from './mailer.service';
import { UserRole } from '../generated/prisma/client';

const PASSWORD = 'Correct-horse-1';
const HASH = bcrypt.hashSync(PASSWORD, 10);
const USER_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Emarath Admin',
  email: 'admin@emarath.local',
  role: UserRole.SUPERADMIN,
  team: null as string | null,
  isActive: true,
  passwordHash: HASH,
};

function makeService(row: typeof USER_ROW | null) {
  const findFirst = jest.fn().mockResolvedValue(row);
  const update = jest.fn().mockResolvedValue(row);
  const signAsync = jest.fn().mockResolvedValue('signed.jwt.token');
  const issue = jest.fn().mockResolvedValue('raw-refresh-token');
  const verify = jest.fn();
  const rotate = jest.fn().mockResolvedValue('rotated-refresh-token');
  const revokeFamily = jest.fn().mockResolvedValue(undefined);
  const revokeByRawToken = jest.fn().mockResolvedValue(undefined);
  const revokeAllForUser = jest.fn().mockResolvedValue(undefined);
  const issueFor = jest.fn().mockResolvedValue('raw-reset-token');
  const consume = jest.fn().mockResolvedValue(USER_ROW.id);
  const sendPasswordReset = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    user: { findFirst, update },
  } as unknown as PrismaService;
  const jwt = { signAsync } as unknown as JwtService;
  const refreshTokens = {
    issue,
    verify,
    rotate,
    revokeFamily,
    revokeByRawToken,
    revokeAllForUser,
  } as unknown as RefreshTokenService;
  const passwordResets = {
    issueFor,
    consume,
  } as unknown as PasswordResetService;
  const mailer = { sendPasswordReset } as unknown as MailerService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      provider: 'log',
      resendApiKey: null,
      from: 'Emarath <no-reply@emarath.local>',
      webAppUrl: 'http://localhost:3000',
    }),
  } as unknown as ConfigService;
  return {
    service: new AuthService(
      prisma,
      jwt,
      refreshTokens,
      passwordResets,
      mailer,
      config,
    ),
    findFirst,
    update,
    signAsync,
    issue,
    verify,
    rotate,
    revokeFamily,
    revokeByRawToken,
    revokeAllForUser,
    issueFor,
    consume,
    sendPasswordReset,
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
    // The access token carries the team claim (AUTH-02.1 / ADR-0030 §4) — null here.
    expect(signAsync).toHaveBeenCalledWith({
      sub: USER_ROW.id,
      role: UserRole.SUPERADMIN,
      team: null,
    });
    // A new family (undefined familyId) — this device's session.
    expect(issue).toHaveBeenCalledWith(USER_ROW.id, undefined, 'jest-agent');
  });

  it("puts a manager's team into the access token (AUTH-02.1)", async () => {
    const { service, signAsync } = makeService({
      ...USER_ROW,
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    });
    await service.login(dto());
    expect(signAsync).toHaveBeenCalledWith({
      sub: USER_ROW.id,
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    });
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
  // The refresh query also selects team (AUTH-02.1) so the rotated token carries it.
  const ROW = { ...PUBLIC, team: 'Sales' };

  it('rotates the refresh token and mints a fresh access token (AC3)', async () => {
    const { service, findFirst, verify, rotate, signAsync } =
      makeService(USER_ROW);
    verify.mockResolvedValue({
      id: 'tok1',
      userId: USER_ROW.id,
      familyId: 'fam1',
    });
    findFirst.mockResolvedValue(ROW);

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
      team: 'Sales',
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

describe('AuthService.requestPasswordReset (AUTH-03.1)', () => {
  it('issues a token and emails a link for a known active account (AC1)', async () => {
    const { service, issueFor, sendPasswordReset } = makeService(USER_ROW);
    await service.requestPasswordReset('admin@emarath.local');

    expect(issueFor).toHaveBeenCalledWith(USER_ROW.id);
    // The link points at the frontend with the raw token, url-encoded.
    expect(sendPasswordReset).toHaveBeenCalledWith({
      to: USER_ROW.email,
      resetUrl: 'http://localhost:3000/reset-password?token=raw-reset-token',
    });
  });

  it('does nothing and still resolves for an unknown email (AC2, no enumeration)', async () => {
    const { service, issueFor, sendPasswordReset } = makeService(null);
    await expect(
      service.requestPasswordReset('nobody@emarath.local'),
    ).resolves.toBeUndefined();
    expect(issueFor).not.toHaveBeenCalled();
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it('only targets active, non-deleted accounts', async () => {
    const { service, findFirst } = makeService(USER_ROW);
    await service.requestPasswordReset('admin@emarath.local');
    const where = (findFirst.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      email: 'admin@emarath.local',
      deletedAt: null,
      isActive: true,
    });
  });
});

describe('AuthService.resetPassword (AUTH-03.1)', () => {
  it('spends the token, stores a new hash and revokes all sessions (AC3/AC5)', async () => {
    const { service, consume, update, revokeAllForUser } =
      makeService(USER_ROW);

    await service.resetPassword('raw-reset-token', 'new-strong-password');

    expect(consume).toHaveBeenCalledWith('raw-reset-token');
    const args = (update.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: { passwordHash: string };
    };
    expect(args.where).toEqual({ id: USER_ROW.id });
    // The stored value is a bcrypt hash of the new password, never the plaintext.
    expect(args.data.passwordHash).not.toBe('new-strong-password');
    expect(
      bcrypt.compareSync('new-strong-password', args.data.passwordHash),
    ).toBe(true);
    expect(revokeAllForUser).toHaveBeenCalledWith(USER_ROW.id);
  });

  it('rejects when the token is invalid/used/expired (AC4) and never writes', async () => {
    const { service, consume, update, revokeAllForUser } =
      makeService(USER_ROW);
    consume.mockRejectedValue(
      new UnauthorizedException('Invalid or expired reset link.'),
    );

    await expect(
      service.resetPassword('bad-token', 'new-strong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it('refuses a reset for an account gone/disabled since the link was issued', async () => {
    const { service, findFirst, update } = makeService(USER_ROW);
    findFirst.mockResolvedValue(null); // deleted or disabled

    await expect(
      service.resetPassword('raw-reset-token', 'new-strong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
  });
});
