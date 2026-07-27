import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Contract smoke test for GET /api/leads/:id (Lead Detail read).
 *
 * Only the input guard is exercised — the UUID param pipe rejects before the
 * service touches the database, so it runs under the Jest VM where the Prisma
 * driver adapter does not (see STATUS.md). The scoped read and its 404 for an
 * out-of-scope/missing/deleted lead are covered by the service unit tests and a
 * live HTTP run, not here.
 */
describe('Lead detail (e2e)', () => {
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

  it('rejects a detail read for a non-uuid id', async () => {
    await request(app.getHttpServer()).get('/api/leads/not-a-uuid').expect(400);
  });
});
