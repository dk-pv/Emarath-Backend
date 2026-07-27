import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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

  it('rejects a summary read with an invalid from date', async () => {
    await request(app.getHttpServer())
      .get('/api/calls/summary?from=not-a-date')
      .expect(400);
  });

  it('rejects a leaderboard read with an invalid from date', async () => {
    await request(app.getHttpServer())
      .get('/api/calls/leaderboard?from=not-a-date')
      .expect(400);
  });

  it('rejects a call log read with an out-of-range page size', async () => {
    await request(app.getHttpServer()).get('/api/calls/log?size=0').expect(400);
  });
});
