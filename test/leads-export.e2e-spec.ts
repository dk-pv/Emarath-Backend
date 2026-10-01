import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for the export endpoint (LEAD-08.1).
 *
 * Only the input guards are exercised here: they reject before the service touches
 * the database, so they run under the Jest VM where the Prisma driver adapter's
 * dynamic import does not (see STATUS.md). A real streamed export is proven by the
 * browser run against the live server, not here.
 */
describe('Leads export (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no format or scope', async () => {
    await api.get('/api/leads/export').expect(400);
  });

  it('rejects an unsupported format (pdf is deferred)', async () => {
    await api.get('/api/leads/export?format=pdf&scope=all').expect(400);
  });

  it('rejects an unknown scope', async () => {
    await api.get('/api/leads/export?format=csv&scope=everything').expect(400);
  });

  it('rejects a malformed columns list', async () => {
    await api
      .get('/api/leads/export?format=csv&scope=default&columns=has%20space')
      .expect(400);
  });
});
