import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for the bulk actions endpoints (LEAD-09.1).
 *
 * Only the input guards are exercised — they reject before the service touches the
 * database, so they run under the Jest VM where the Prisma driver adapter does not
 * (see STATUS.md). The scoped reassign/delete behaviour is proven by the curl run
 * against the live server, not here.
 */
describe('Leads bulk actions (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;
  const uuid = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a delete with an empty id set', async () => {
    await api.post('/api/leads/bulk/delete').send({ ids: [] }).expect(400);
  });

  it('rejects a delete with a non-uuid id', async () => {
    await api
      .post('/api/leads/bulk/delete')
      .send({ ids: ['not-a-uuid'] })
      .expect(400);
  });

  it('rejects a reassign with no target agent', async () => {
    await api
      .post('/api/leads/bulk/reassign')
      .send({ ids: [uuid] })
      .expect(400);
  });

  it('rejects a reassign with a non-uuid target agent', async () => {
    await api
      .post('/api/leads/bulk/reassign')
      .send({ ids: [uuid], agentId: 'nope' })
      .expect(400);
  });
});
