import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Contract smoke test for POST /api/activities (ACT-03.1).
 *
 * Only the input guards are exercised — the DTO validation rejects before the
 * service touches the database, so they run under the Jest VM where the Prisma
 * driver adapter does not (see STATUS.md). The scoped create behaviour (lead
 * scope, derived title, type-conditional fields, self-assign) is covered by the
 * service unit tests and a live HTTP run, not here. Every payload below is
 * invalid, so none reaches the DB.
 */
describe('Create activity (e2e)', () => {
  let app: INestApplication<App>;
  const uuid = '11111111-1111-1111-1111-111111111111';
  const dueAt = '2026-08-01T09:00:00.000Z';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = () => request(app.getHttpServer()).post('/api/activities');
  const get = () => request(app.getHttpServer()).get('/api/activities');
  const bounds = {
    todayStart: '2026-07-24T00:00:00.000Z',
    todayEnd: '2026-07-25T00:00:00.000Z',
    tomorrowEnd: '2026-07-26T00:00:00.000Z',
  };

  it('rejects an empty body', async () => {
    await post().send({}).expect(400);
  });

  it('rejects an unknown follow-up type', async () => {
    await post()
      .send({
        type: 'EMAIL',
        leadId: uuid,
        description: 'x',
        dueAt,
        assigneeIds: [uuid],
      })
      .expect(400);
  });

  it('rejects a non-uuid lead id', async () => {
    await post()
      .send({
        type: 'CALL',
        leadId: 'nope',
        description: 'x',
        dueAt,
        assigneeIds: [uuid],
      })
      .expect(400);
  });

  it('rejects an empty description (required in the form)', async () => {
    await post()
      .send({
        type: 'CALL',
        leadId: uuid,
        description: '',
        dueAt,
        assigneeIds: [uuid],
      })
      .expect(400);
  });

  it('rejects an invalid due date', async () => {
    await post()
      .send({
        type: 'CALL',
        leadId: uuid,
        description: 'x',
        dueAt: 'not-a-date',
        assigneeIds: [uuid],
      })
      .expect(400);
  });

  it('rejects an empty assignee list', async () => {
    await post()
      .send({
        type: 'CALL',
        leadId: uuid,
        description: 'x',
        dueAt,
        assigneeIds: [],
      })
      .expect(400);
  });

  it('rejects an unknown field', async () => {
    await post()
      .send({
        type: 'CALL',
        leadId: uuid,
        description: 'x',
        dueAt,
        assigneeIds: [uuid],
        foo: 'bar',
      })
      .expect(400);
  });

  // GET /api/activities — only the input guards run under the Jest VM; a valid
  // list call reaches the DB (the driver adapter is unavailable here), so the
  // scoped list/bucket/count behaviour is covered by the service unit tests.
  it('rejects an unknown bucket', async () => {
    await get()
      .query({ ...bounds, bucket: 'nope' })
      .expect(400);
  });

  it('rejects a missing day boundary', async () => {
    await get()
      .query({ bucket: 'today', todayStart: bounds.todayStart })
      .expect(400);
  });

  it('rejects page 0', async () => {
    await get()
      .query({ ...bounds, page: 0 })
      .expect(400);
  });

  it('rejects a size over the max', async () => {
    await get()
      .query({ ...bounds, size: 9999 })
      .expect(400);
  });

  it('rejects an unknown query field', async () => {
    await get()
      .query({ ...bounds, foo: 'bar' })
      .expect(400);
  });

  // Search + filter guards (ACT-07.1) — input validation runs under the Jest VM;
  // the scoped search/filter behaviour is covered by the unit tests.
  it('rejects an over-long search', async () => {
    await get()
      .query({ ...bounds, search: 'x'.repeat(201) })
      .expect(400);
  });

  it('rejects a non-uuid assignee filter', async () => {
    await get()
      .query({ ...bounds, assignedAgent: 'nope' })
      .expect(400);
  });

  // PATCH /api/activities/:id/complete — the UUID pipe guards the id before the
  // service runs; the scoped, idempotent completion is covered by unit tests.
  it('rejects complete for a non-uuid id', async () => {
    await request(app.getHttpServer())
      .patch('/api/activities/not-a-uuid/complete')
      .expect(400);
  });

  // POST /api/activities/:id/duplicate — the UUID pipe guards the id (ACT-08.1);
  // the scoped copy is covered by unit tests.
  it('rejects duplicate for a non-uuid id', async () => {
    await request(app.getHttpServer())
      .post('/api/activities/not-a-uuid/duplicate')
      .expect(400);
  });

  // PATCH /api/activities/:id — edit guards (ACT-05.1). The scoped update is
  // covered by unit tests; a valid body would reach the DB.
  const patch = () =>
    request(app.getHttpServer()).patch(`/api/activities/${uuid}`);

  it('rejects an edit for a non-uuid id', async () => {
    await request(app.getHttpServer())
      .patch('/api/activities/not-a-uuid')
      .send({
        type: 'CALL',
        description: 'x',
        dueAt,
        assigneeIds: [uuid],
      })
      .expect(400);
  });

  it('rejects an edit with an empty body', async () => {
    await patch().send({}).expect(400);
  });

  it('rejects an edit with an unknown field', async () => {
    await patch()
      .send({
        type: 'CALL',
        description: 'x',
        dueAt,
        assigneeIds: [uuid],
        leadId: uuid,
      })
      .expect(400);
  });

  // DELETE /api/activities/:id — the UUID pipe guards the id before the service
  // runs; the scoped, idempotent soft delete is covered by unit tests.
  it('rejects a delete for a non-uuid id', async () => {
    await request(app.getHttpServer())
      .delete('/api/activities/not-a-uuid')
      .expect(400);
  });
});
