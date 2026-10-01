import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for GET /api/leads/:id (Lead Detail read).
 *
 * Only the input guard is exercised — the UUID param pipe rejects before the
 * service touches the database, so it runs under the Jest VM where the Prisma
 * driver adapter does not (see STATUS.md). The scoped read and its 404 for an
 * out-of-scope/missing/deleted lead are covered by the service unit tests and a
 * live HTTP run, not here.
 */
describe('Lead detail (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a detail read for a non-uuid id', async () => {
    await api.get('/api/leads/not-a-uuid').expect(400);
  });
});
