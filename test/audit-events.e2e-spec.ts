import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp } from './e2e-app';

const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Contract test for GET /api/audit/events (the customer journey read).
 *
 * Like every spec here, only what a guard or a pipe decides is exercised — the Prisma driver
 * adapter does not run under the Jest VM (see e2e-app.ts). That is exactly this layer's job:
 * which roles the route admits, and that a malformed leadId is refused before any query runs.
 * The scoped read itself is covered by the service unit tests.
 */
describe('Audit journey (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  /** A session for `role`, minted by the app's own JwtService as the shared agent's is. */
  const cookieFor = async (role: UserRole): Promise<string> => {
    const token = await app
      .get(JwtService)
      .signAsync({ sub: E2E_USER_ID, role, team: 'Sales' });
    return `access_token=${token}`;
  };

  /*
    Guards run before pipes. A malformed id therefore tells the two apart for every role: 403
    means the guard refused the role, 400 means it admitted the role and the pipe then refused
    the id — before the service, so no query ever ran with it.
  */
  it.each(
    Object.values(UserRole).map(
      (role) =>
        [role, role === UserRole.ACCOUNTS_EXECUTIVE ? 403 : 400] as const,
    ),
  )('%s gets %i for a malformed leadId', async (role, status) => {
    await request(app.getHttpServer())
      .get('/api/audit/events?leadId=not-a-uuid')
      .set('Cookie', await cookieFor(role))
      .expect(status);
  });

  it('refuses a read with no leadId', async () => {
    await request(app.getHttpServer())
      .get('/api/audit/events')
      .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
      .expect(400);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'has no %s route: the log cannot be written through the API',
    async (verb) => {
      await request(app.getHttpServer())
        [verb]('/api/audit/events')
        .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
        .expect(404);
    },
  );
});
