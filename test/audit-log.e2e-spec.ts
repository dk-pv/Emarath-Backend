import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp } from './e2e-app';

const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Contract test for the administrator's audit log, GET /api/audit/log (AUD-02).
 *
 * Only what a guard or a pipe decides is exercised — the Prisma driver adapter does not run under
 * the Jest VM (see e2e-app.ts). Guards run before pipes, so a malformed parameter tells them
 * apart: 403 means the role was refused, 400 means it was admitted and the query then refused —
 * before the service, so no read ever ran. The read itself is covered by the service unit tests
 * and the disposable-database checks.
 */
describe('Audit log (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const cookieFor = async (role: UserRole): Promise<string> => {
    const token = await app
      .get(JwtService)
      .signAsync({ sub: E2E_USER_ID, role, team: 'Sales' });
    return `access_token=${token}`;
  };

  const others = Object.values(UserRole).filter(
    (role) => role !== UserRole.SUPERADMIN,
  );

  it('refuses a caller with no session', async () => {
    await request(app.getHttpServer()).get('/api/audit/log').expect(401);
    await request(app.getHttpServer())
      .get('/api/audit/log/filter-options')
      .expect(401);
  });

  it.each(others)('%s is refused (403) on both routes', async (role) => {
    const cookie = await cookieFor(role);
    await request(app.getHttpServer())
      .get('/api/audit/log?page=0')
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/audit/log/filter-options')
      .set('Cookie', cookie)
      .expect(403);
  });

  it.each([
    'page=0',
    'page=1001',
    'size=0',
    'size=101',
    'page=abc',
    'entityType=PASSWORD',
    'actorId=not-a-uuid',
    'from=yesterday',
    'to=2026-02-30',
    'unknown=1',
  ])('admits Super Admin, then refuses %s with a 400', async (params) => {
    await request(app.getHttpServer())
      .get(`/api/audit/log?${params}`)
      .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
      .expect(400);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'has no %s route: the log cannot be written through the API',
    async (method) => {
      await request(app.getHttpServer())
        [method]('/api/audit/log')
        .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
        .expect(404);
    },
  );
});
