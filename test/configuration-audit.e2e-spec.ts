import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp } from './e2e-app';

const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';
const ID = '00000000-0000-4000-8000-000000000001';

/**
 * Contract test for the configuration routes AUD-04 records (lead categories and message
 * templates): auditing them changed no authorization. Only what a guard or a pipe decides is
 * exercised — the Prisma driver adapter does not run under the Jest VM (see e2e-app.ts). Guards
 * run before pipes, so a malformed request tells them apart: 403 means the role was refused, 400
 * means it was admitted and the input refused — before the service, so nothing was written and
 * nothing recorded. What is recorded is covered by the service unit tests and the
 * disposable-database checks.
 */
describe('Configuration audit routes (e2e)', () => {
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

  /** Every write route, each with a body the validation refuses. */
  const writes: [string, string, object][] = [
    ['post', '/api/categories', {}],
    ['patch', `/api/categories/${ID}`, { name: 42 }],
    ['patch', `/api/categories/${ID}/move`, { position: 'first' }],
    ['delete', '/api/categories/not-an-id', {}],
    ['post', '/api/message-templates', { name: '', type: 'SMS' }],
    ['patch', `/api/message-templates/${ID}`, { type: 'SMS' }],
    ['delete', '/api/message-templates/not-an-id', {}],
  ];
  const send = (method: string, path: string, body: object) => {
    const call = server();
    const req =
      method === 'post'
        ? call.post(path)
        : method === 'patch'
          ? call.patch(path)
          : call.delete(path);
    return req.send(body);
  };

  it('refuses every write without a session (401)', async () => {
    for (const [method, path, body] of writes) {
      const response = await send(method, path, body);
      expect([path, response.status]).toEqual([path, 401]);
    }
  });

  it.each(notAdmin)(
    '%s is refused every category and template write (403), as before',
    async (role) => {
      const cookie = await cookieFor(role);
      for (const [method, path, body] of writes) {
        const response = await send(method, path, body).set('Cookie', cookie);
        expect([path, response.status]).toEqual([path, 403]);
      }
    },
  );

  it('admits the Super Admin, whose malformed writes are refused before anything is written (400)', async () => {
    const cookie = await cookieFor(UserRole.SUPERADMIN);
    for (const [method, path, body] of writes) {
      const response = await send(method, path, body).set('Cookie', cookie);
      expect([path, response.status]).toEqual([path, 400]);
    }
  });

  it('refuses an unknown body field on a category or template edit (400)', async () => {
    const cookie = await cookieFor(UserRole.SUPERADMIN);
    for (const path of [
      `/api/categories/${ID}`,
      `/api/message-templates/${ID}`,
    ]) {
      const response = await server()
        .patch(path)
        .set('Cookie', cookie)
        .send({ createdById: E2E_USER_ID });
      expect([path, response.status]).toEqual([path, 400]);
    }
  });

  it('keeps the Audit Log Super Admin only, and refuses a record type it does not know', async () => {
    for (const role of notAdmin) {
      await server()
        .get('/api/audit/log?entityType=CATEGORY')
        .set('Cookie', await cookieFor(role))
        .expect(403);
    }
    await server()
      .get('/api/audit/log?entityType=MESSAGE_TEMPLATES')
      .set('Cookie', await cookieFor(UserRole.SUPERADMIN))
      .expect(400);
  });
});
