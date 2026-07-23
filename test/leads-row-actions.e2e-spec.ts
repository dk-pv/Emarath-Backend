import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Contract smoke test for the row quick-action endpoints (LEAD-10.1).
 *
 * Only the input guards are exercised — the UUID param pipe and the DTO
 * validation reject before the service touches the database, so they run under
 * the Jest VM where the Prisma driver adapter does not (see STATUS.md). The
 * scoped duplicate/reassign/status/delete behaviour is proven by the live HTTP
 * run against the running server, not here.
 */
describe('Leads row quick actions (e2e)', () => {
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

  it('rejects a duplicate for a non-uuid lead id', async () => {
    await request(app.getHttpServer())
      .post('/api/leads/not-a-uuid/duplicate')
      .expect(400);
  });

  it('rejects a delete for a non-uuid lead id', async () => {
    await request(app.getHttpServer())
      .delete('/api/leads/not-a-uuid')
      .expect(400);
  });

  it('rejects a reassign with no target agent', async () => {
    await request(app.getHttpServer())
      .post(`/api/leads/${uuid}/reassign`)
      .send({})
      .expect(400);
  });

  it('rejects a reassign with a non-uuid target agent', async () => {
    await request(app.getHttpServer())
      .post(`/api/leads/${uuid}/reassign`)
      .send({ agentId: 'nope' })
      .expect(400);
  });

  it('rejects a status change with an empty value', async () => {
    await request(app.getHttpServer())
      .post(`/api/leads/${uuid}/status`)
      .send({ status: '' })
      .expect(400);
  });

  it('rejects a status change with an unknown field', async () => {
    await request(app.getHttpServer())
      .post(`/api/leads/${uuid}/status`)
      .send({ status: 'New', foo: 'bar' })
      .expect(400);
  });
});
