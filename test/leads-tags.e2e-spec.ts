import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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
  const uuid = '11111111-1111-1111-1111-111111111111';

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

  it('rejects adding a tag to a non-uuid lead id', async () => {
    await request(app.getHttpServer())
      .post('/api/leads/not-a-uuid/tags')
      .send({ tagId: uuid })
      .expect(400);
  });

  it('rejects adding a tag with no tag id', async () => {
    await request(app.getHttpServer())
      .post(`/api/leads/${uuid}/tags`)
      .send({})
      .expect(400);
  });

  it('rejects adding a tag with a non-uuid tag id', async () => {
    await request(app.getHttpServer())
      .post(`/api/leads/${uuid}/tags`)
      .send({ tagId: 'nope' })
      .expect(400);
  });

  it('rejects adding a tag with an unknown field', async () => {
    await request(app.getHttpServer())
      .post(`/api/leads/${uuid}/tags`)
      .send({ tagId: uuid, foo: 'bar' })
      .expect(400);
  });

  it('rejects removing a tag from a non-uuid lead id', async () => {
    await request(app.getHttpServer())
      .delete(`/api/leads/not-a-uuid/tags/${uuid}`)
      .expect(400);
  });

  it('rejects removing a non-uuid tag id', async () => {
    await request(app.getHttpServer())
      .delete(`/api/leads/${uuid}/tags/not-a-uuid`)
      .expect(400);
  });
});
