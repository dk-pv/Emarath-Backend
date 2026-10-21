import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp } from './e2e-app';

const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';
const EXPORT = '/api/logistics/orders/export';

/**
 * Contract test for the delivery-partner export (3PL-01): who reaches it and what it refuses
 * before the service runs. Only what a guard or a pipe decides is exercised — the Prisma driver
 * adapter does not run under the Jest VM (see e2e-app.ts). Guards run before pipes, so a malformed
 * request tells them apart: 403 means the role was refused, 400 means it was admitted and the input
 * refused, with nothing read and nothing recorded. The file itself and its audit event are covered
 * by the service unit tests and the disposable-database checks.
 */
describe('Logistics delivery-partner export (e2e)', () => {
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
  const exporters: UserRole[] = [
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.SUPERADMIN,
  ];
  const others = Object.values(UserRole).filter(
    (role) => !exporters.includes(role),
  );

  it('refuses a caller without a session (401)', async () => {
    await server().get(EXPORT).expect(401);
  });

  it.each(others)(
    '%s is refused the export (403), filters or not',
    async (role) => {
      const cookie = await cookieFor(role);
      await server().get(EXPORT).set('Cookie', cookie).expect(403);
      await server()
        .get(`${EXPORT}?status=SHIPPED`)
        .set('Cookie', cookie)
        .expect(403);
    },
  );

  it.each(exporters)(
    '%s is admitted, and an invalid filter is refused before anything is read (400)',
    async (role) => {
      const cookie = await cookieFor(role);
      const status = await server()
        .get(`${EXPORT}?status=SHIPPED`)
        .set('Cookie', cookie)
        .expect(400);
      // The export's own validation, not the `:id` route's UUID check.
      expect(JSON.stringify(status.body)).toContain(
        'each status must be one of',
      );
      await server()
        .get(`${EXPORT}?deliveryOn=2026-13-40`)
        .set('Cookie', cookie)
        .expect(400);
    },
  );

  it('refuses a parameter the export does not take, such as a page or a sort (400)', async () => {
    const cookie = await cookieFor(UserRole.LOGISTICS_EXECUTIVE);
    for (const query of ['page=2', 'sort=orderNumber', 'format=xlsx']) {
      const response = await server()
        .get(`${EXPORT}?${query}`)
        .set('Cookie', cookie);
      expect([query, response.status]).toEqual([query, 400]);
    }
  });
});
