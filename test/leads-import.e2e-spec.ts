import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Routing/contract smoke test for the import endpoints.
 *
 * Kept to the paths that do not touch the database: the Prisma driver adapter's
 * dynamic import does not resolve under the Jest VM (a known limitation, see
 * STATUS.md), so DB-backed behaviour is proven by the browser run against the live
 * server, not here. What this locks down is the wiring, the global `/api` prefix,
 * the field catalog and the input guards.
 */
describe('Leads import (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/leads/import/fields returns the catalog with required fields', async () => {
    const res = await api.get('/api/leads/import/fields').expect(200);

    const body = res.body as { fields: { value: string; required: boolean }[] };
    const required = body.fields
      .filter((field) => field.required)
      .map((field) => field.value);
    // Exactly what New Lead requires (ADR-0088).
    expect(required).toEqual(['name', 'primaryPhone']);
  });

  it('POST /api/leads/import/validate without a file is a 400', async () => {
    await api
      .post('/api/leads/import/validate')
      .field('mapping', '{}')
      .field('pipeline', 'Lead Pipeline')
      .expect(400);
  });

  it('GET /api/leads/import/:jobId rejects a non-uuid id', async () => {
    await api.get('/api/leads/import/not-a-uuid').expect(400);
  });
});
