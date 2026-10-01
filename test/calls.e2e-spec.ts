import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for GET /api/calls/summary (CALL-03.1).
 *
 * Only the input guard is exercised — an invalid `from` date is rejected by the
 * ValidationPipe before the service touches the database, so it runs under the
 * Jest VM where the Prisma driver adapter does not (see STATUS.md). The scoped
 * aggregation is covered by the service unit tests and a live HTTP run.
 */
describe('Call summary (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a summary read with an invalid from date', async () => {
    await api.get('/api/calls/summary?from=not-a-date').expect(400);
  });

  it('rejects a leaderboard read with an invalid from date', async () => {
    await api.get('/api/calls/leaderboard?from=not-a-date').expect(400);
  });

  it('rejects a call log read with an out-of-range page size', async () => {
    await api.get('/api/calls/log?size=0').expect(400);
  });
});
