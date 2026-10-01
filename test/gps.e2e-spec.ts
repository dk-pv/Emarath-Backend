import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for the GPS check-in API (GPS-02.1).
 *
 * Only the input guards are exercised — out-of-range coordinates and a non-uuid
 * check-out id are rejected by the ValidationPipe / ParseUUIDPipe before the
 * service touches the database, so they run under the Jest VM where the Prisma
 * driver adapter does not (see STATUS.md).
 */
describe('GPS check-in (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a check-in with out-of-range coordinates (AC5)', async () => {
    await api
      .post('/api/gps/check-ins')
      .send({ latitude: 200, longitude: 55 })
      .expect(400);
  });

  it('rejects a check-out for a non-uuid check-in id', async () => {
    await api
      .patch('/api/gps/check-ins/not-a-uuid/check-out')
      .send({ latitude: 25, longitude: 55 })
      .expect(400);
  });

  it('rejects a location point with out-of-range coordinates (GPS-03.1)', async () => {
    await api
      .post('/api/gps/location-points')
      .send({ latitude: 25, longitude: 200 })
      .expect(400);
  });
});

describe('GPS summary (e2e)', () => {
  let app: INestApplication<App>;
  let api: E2EAgent;

  beforeAll(async () => {
    ({ app, api } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a summary request with an invalid date string', async () => {
    await api.get('/api/gps/summary?dateFrom=not-a-date').expect(400);
  });

  it('rejects a summary request with an invalid user id', async () => {
    await api.get('/api/gps/summary?userId=not-a-uuid').expect(400);
  });
});
