import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp } from './e2e-app';

const USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * The account behind a session is checked on every request (SEC-04), over real HTTP and the
 * real guard order: authentication, then the role gate, then validation. The lookup is the
 * harness stub (no database runs here); which accounts its filter matches is the guard unit
 * spec's job, and the scratch validation's against PostgreSQL. A malformed Accounts list query
 * tells the outcomes apart without a query: 401 the session, 403 the role, 400 admitted.
 */
describe('Session account check (e2e)', () => {
  let app: INestApplication<App>;
  let account: Awaited<ReturnType<typeof createE2EApp>>['account'];

  beforeAll(async () => {
    ({ app, account } = await createE2EApp());
  });

  beforeEach(() => account.mockClear());

  afterAll(async () => {
    await app.close();
  });

  const cookieFor = async (
    role: UserRole,
    options: { expiresIn?: number } = {},
  ): Promise<string> => {
    const token = await app
      .get(JwtService)
      .signAsync({ sub: USER_ID, role, team: 'Sales' }, options);
    return `access_token=${token}`;
  };

  const listRecords = (cookie: string) =>
    request(app.getHttpServer())
      .get('/api/accounts/records?size=0')
      .set('Cookie', cookie);

  it.each(
    Object.values(UserRole).map(
      (role) =>
        [
          role,
          role === UserRole.SUPERADMIN || role === UserRole.ACCOUNTS_EXECUTIVE
            ? 400
            : 403,
        ] as const,
    ),
  )(
    'checks the account, then applies the role gate as before: %s → %i',
    async (role, status) => {
      await listRecords(await cookieFor(role)).expect(status);
      expect(account).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses a session whose account was removed or deactivated after sign-in', async () => {
    const cookie = await cookieFor(UserRole.ACCOUNTS_EXECUTIVE);
    await listRecords(cookie).expect(400);

    account.mockResolvedValueOnce(null);
    const refused = await listRecords(cookie).expect(401);
    expect(refused.body).toMatchObject({ message: 'Invalid session.' });
  });

  it('fails closed when the account cannot be looked up', async () => {
    account.mockRejectedValueOnce(new Error('connection refused'));
    const failed = await listRecords(
      await cookieFor(UserRole.SUPERADMIN),
    ).expect(500);
    expect(JSON.stringify(failed.body)).not.toContain('connection refused');
  });

  it('keeps refusing an expired token before any lookup', async () => {
    await listRecords(
      await cookieFor(UserRole.SUPERADMIN, { expiresIn: -10 }),
    ).expect(401);
    expect(account).not.toHaveBeenCalled();
  });

  it('keeps refusing a malformed token before any lookup', async () => {
    await listRecords('access_token=not-a-token').expect(401);
    expect(account).not.toHaveBeenCalled();
  });

  it('leaves a public route open without a session or a lookup', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(account).not.toHaveBeenCalled();
  });
});
