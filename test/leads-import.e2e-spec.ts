import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Routing/contract smoke test for the import endpoints.
 *
 * Kept to the paths that do not touch the database: the Prisma driver adapter's
 * dynamic import does not resolve under the Jest VM (a known limitation, see
 * STATUS.md), so DB-backed behaviour is proven by the browser run against the live
 * server, not here. What this locks down is the wiring, the global `/api` prefix,
 * the field catalog and the input guards.
 */
describe('Leads import (e2e)', () => {
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

  it('GET /api/leads/import/fields returns the catalog with required fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/leads/import/fields')
      .expect(200);

    const body = res.body as { fields: { value: string; required: boolean }[] };
    const required = body.fields
      .filter((field) => field.required)
      .map((field) => field.value);
    expect(required).toEqual([
      'name',
      'primaryPhone',
      'actualAmount',
      'paymentMethod',
    ]);
  });

  it('POST /api/leads/import/validate without a file is a 400', async () => {
    await request(app.getHttpServer())
      .post('/api/leads/import/validate')
      .field('mapping', '{}')
      .field('pipeline', 'Lead Pipeline')
      .expect(400);
  });

  it('GET /api/leads/import/:jobId rejects a non-uuid id', async () => {
    await request(app.getHttpServer())
      .get('/api/leads/import/not-a-uuid')
      .expect(400);
  });
});
