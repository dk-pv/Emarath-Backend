import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Cross-site request forgery: a write a browser sends from a page on another site carries the
 * victim's cookies when they are SameSite=None (hosted, frontend and API are on different sites).
 * It is refused before the session guard and the validation pipe ever run — so the 403 below is
 * the origin check's, not an authorization or validation outcome — while the app's own origin,
 * non-browser clients and safe methods behave exactly as before.
 */
describe('Cross-site writes are refused (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;
  let allowed: string;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
    allowed = app.get(ConfigService).getOrThrow<AppConfig>('app').corsOrigin[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a signed-in write from another site (403), though the same body is otherwise a 400', async () => {
    const forged = await api
      .post('/api/leads')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(forged.status).toBe(403);
    expect(forged.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });

    await api.post('/api/leads').send({}).expect(400);
    await api.post('/api/leads').set('Origin', allowed).send({}).expect(400);
  });

  it('refuses the form-encoded post a hostile page can send without a preflight', async () => {
    await api
      .post('/api/teams/assign')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send('team=Other&userIds[0]=11111111-1111-1111-1111-111111111111')
      .expect(403);
  });

  it('refuses PATCH and DELETE from another site as well', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    await api
      .patch(`/api/logistics/orders/${id}`)
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    await api
      .delete(`/api/leads/${id}`)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('refuses a cross-site login, too: no session is started from another site', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'x@example.com', password: 'x' })
      .expect(403);
  });

  it('leaves safe methods alone, whatever their origin', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
  });
});
