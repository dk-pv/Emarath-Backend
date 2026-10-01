import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for the Kanban board endpoint (KAN-02.1).
 *
 * Only the input guards are exercised — DTO validation rejects before the service
 * touches the database, so they run under the Jest VM where the Prisma driver
 * adapter does not (see STATUS.md). The scoped grouping/aggregation is proven by
 * the live HTTP run against the running server, not here.
 */
describe('Leads board (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unknown query field', async () => {
    await api.get('/api/leads/board?foo=bar').expect(400);
  });

  it('rejects a pipeline longer than the column width', async () => {
    await api.get(`/api/leads/board?pipeline=${'x'.repeat(65)}`).expect(400);
  });
});
