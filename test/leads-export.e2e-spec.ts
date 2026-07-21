import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Contract smoke test for the export endpoint (LEAD-08.1).
 *
 * Only the input guards are exercised here: they reject before the service touches
 * the database, so they run under the Jest VM where the Prisma driver adapter's
 * dynamic import does not (see STATUS.md). A real streamed export is proven by the
 * browser run against the live server, not here.
 */
describe('Leads export (e2e)', () => {
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

  it('rejects a request with no format or scope', async () => {
    await request(app.getHttpServer()).get('/api/leads/export').expect(400);
  });

  it('rejects an unsupported format (pdf is deferred)', async () => {
    await request(app.getHttpServer())
      .get('/api/leads/export?format=pdf&scope=all')
      .expect(400);
  });

  it('rejects an unknown scope', async () => {
    await request(app.getHttpServer())
      .get('/api/leads/export?format=csv&scope=everything')
      .expect(400);
  });

  it('rejects a malformed columns list', async () => {
    await request(app.getHttpServer())
      .get('/api/leads/export?format=csv&scope=default&columns=has%20space')
      .expect(400);
  });
});
