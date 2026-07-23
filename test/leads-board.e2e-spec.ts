import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Contract smoke test for the Kanban board endpoint (KAN-02.1).
 *
 * Only the input guards are exercised — DTO validation rejects before the service
 * touches the database, so they run under the Jest VM where the Prisma driver
 * adapter does not (see STATUS.md). The scoped grouping/aggregation is proven by
 * the live HTTP run against the running server, not here.
 */
describe('Leads board (e2e)', () => {
  let app: INestApplication<App>;

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

  it('rejects an unknown query field', async () => {
    await request(app.getHttpServer())
      .get('/api/leads/board?foo=bar')
      .expect(400);
  });

  it('rejects a pipeline longer than the column width', async () => {
    await request(app.getHttpServer())
      .get(`/api/leads/board?pipeline=${'x'.repeat(65)}`)
      .expect(400);
  });
});
