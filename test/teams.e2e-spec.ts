import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { OPERATIONAL_ROLES } from '../src/auth/role-groups';
import { createE2EApp } from './e2e-app';

const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';
const MEMBER = '00000000-0000-4000-8000-000000000001';

/**
 * Contract test for Teams v1: team administration (`/api/teams`) and Team Performance
 * (`/api/reports/team-performance`).
 *
 * Only what a guard or a pipe decides is exercised — the Prisma driver adapter does not run under
 * the Jest VM (see e2e-app.ts). Guards run before pipes, so a malformed body or parameter tells
 * them apart: 403 means the role was refused, 400 means it was admitted and the input refused —
 * before the service, so nothing was read or written. The behaviour itself is covered by the
 * service unit tests and the disposable-database checks.
 */
describe('Teams (e2e)', () => {
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
  const server = () => request(app.getHttpServer());

  const notAdmin = Object.values(UserRole).filter(
    (role) => role !== UserRole.SUPERADMIN,
  );
  const salesRoles = Object.values(UserRole).filter(
    (role) => !OPERATIONAL_ROLES.includes(role),
  );

  describe('/api/teams', () => {
    it('refuses a caller with no session on every route', async () => {
      await server().get('/api/teams').expect(401);
      await server().post('/api/teams').send({}).expect(401);
      await server().post('/api/teams/rename').send({}).expect(401);
      await server().post('/api/teams/assign').send({}).expect(401);
    });

    it.each(notAdmin)('%s is refused (403) on every route', async (role) => {
      const cookie = await cookieFor(role);
      await server().get('/api/teams').set('Cookie', cookie).expect(403);
      // An invalid body as well: a 403 here can only be the role gate.
      await server()
        .post('/api/teams')
        .set('Cookie', cookie)
        .send({})
        .expect(403);
      await server()
        .post('/api/teams/rename')
        .set('Cookie', cookie)
        .send({})
        .expect(403);
      await server()
        .post('/api/teams/assign')
        .set('Cookie', cookie)
        .send({})
        .expect(403);
    });

    it.each([
      ['/api/teams', { name: '   ', memberIds: [MEMBER] }],
      ['/api/teams', { name: 'Alpha', memberIds: [] }],
      ['/api/teams', { name: 'Alpha', memberIds: [MEMBER, MEMBER] }],
      ['/api/teams', { name: 'Alpha', memberIds: ['not-an-id'] }],
      ['/api/teams', { name: 'x'.repeat(121), memberIds: [MEMBER] }],
      ['/api/teams', { name: 'Alpha', memberIds: [MEMBER], extra: true }],
      ['/api/teams/rename', { name: 'Alpha' }],
      ['/api/teams/rename', { name: 'Alpha', newName: ' ' }],
      ['/api/teams/assign', { userIds: [MEMBER] }],
      ['/api/teams/assign', { team: '', userIds: [MEMBER] }],
      ['/api/teams/assign', { team: 'Alpha', userIds: [] }],
    ])(
      'admits Super Admin, then refuses %s %j with a 400',
      async (path, body) => {
        await server()
          .post(path)
          .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
          .send(body)
          .expect(400);
      },
    );

    it.each(['put', 'patch', 'delete'] as const)(
      'has no %s route: a team is never deleted or replaced wholesale',
      async (method) => {
        await server()
          [method]('/api/teams')
          .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
          .expect(404);
      },
    );
  });

  describe('/api/reports/team-performance', () => {
    it('refuses a caller with no session', async () => {
      await server().get('/api/reports/team-performance').expect(401);
      await server()
        .get('/api/reports/team-performance/filter-options')
        .expect(401);
    });

    it.each(OPERATIONAL_ROLES)(
      '%s is refused (403): post-sale roles see no sales figures',
      async (role) => {
        const cookie = await cookieFor(role);
        await server()
          .get('/api/reports/team-performance?from=yesterday')
          .set('Cookie', cookie)
          .expect(403);
        await server()
          .get('/api/reports/team-performance/filter-options')
          .set('Cookie', cookie)
          .expect(403);
      },
    );

    it.each(salesRoles)(
      '%s is admitted, then a malformed filter is a 400',
      async (role) => {
        await server()
          .get('/api/reports/team-performance?from=yesterday')
          .set('Cookie', await cookieFor(role))
          .expect(400);
      },
    );

    it.each([
      'to=2026-02-30',
      'agent=not-an-id',
      'manager=not-an-id',
      `team=${'x'.repeat(121)}`,
      'unknown=1',
    ])('refuses %s with a 400', async (params) => {
      await server()
        .get(`/api/reports/team-performance?${params}`)
        .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
        .expect(400);
    });
  });
});
