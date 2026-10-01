import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for the per-lead tag endpoints (LEAD-12.1).
 *
 * Only the input guards are exercised — the UUID param pipes and the DTO
 * validation reject before the service touches the database, so they run under
 * the Jest VM where the Prisma driver adapter does not (see STATUS.md). The
 * scoped add/remove behaviour and AC5 duplicate prevention are proven by the
 * live HTTP run against the running server, not here.
 */
describe('Leads per-lead tags (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;
  const uuid = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects adding a tag to a non-uuid lead id', async () => {
    await api
      .post('/api/leads/not-a-uuid/tags')
      .send({ tagId: uuid })
      .expect(400);
  });

  it('rejects adding a tag with no tag id', async () => {
    await api.post(`/api/leads/${uuid}/tags`).send({}).expect(400);
  });

  it('rejects adding a tag with a non-uuid tag id', async () => {
    await api
      .post(`/api/leads/${uuid}/tags`)
      .send({ tagId: 'nope' })
      .expect(400);
  });

  it('rejects adding a tag with an unknown field', async () => {
    await api
      .post(`/api/leads/${uuid}/tags`)
      .send({ tagId: uuid, foo: 'bar' })
      .expect(400);
  });

  it('rejects removing a tag from a non-uuid lead id', async () => {
    await api.delete(`/api/leads/not-a-uuid/tags/${uuid}`).expect(400);
  });

  it('rejects removing a non-uuid tag id', async () => {
    await api.delete(`/api/leads/${uuid}/tags/not-a-uuid`).expect(400);
  });
});
