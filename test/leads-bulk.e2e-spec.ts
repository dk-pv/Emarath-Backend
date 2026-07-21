import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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

  it('rejects a delete with an empty id set', async () => {
    await request(app.getHttpServer())
      .post('/api/leads/bulk/delete')
      .send({ ids: [] })
      .expect(400);
  });

  it('rejects a delete with a non-uuid id', async () => {
    await request(app.getHttpServer())
      .post('/api/leads/bulk/delete')
      .send({ ids: ['not-a-uuid'] })
      .expect(400);
  });

  it('rejects a reassign with no target agent', async () => {
    await request(app.getHttpServer())
      .post('/api/leads/bulk/reassign')
      .send({ ids: [uuid] })
      .expect(400);
  });

  it('rejects a reassign with a non-uuid target agent', async () => {
    await request(app.getHttpServer())
      .post('/api/leads/bulk/reassign')
      .send({ ids: [uuid], agentId: 'nope' })
      .expect(400);
  });
});
