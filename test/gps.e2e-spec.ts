import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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

  it('rejects a check-in with out-of-range coordinates (AC5)', async () => {
    await request(app.getHttpServer())
      .post('/api/gps/check-ins')
      .send({ latitude: 200, longitude: 55 })
      .expect(400);
  });

  it('rejects a check-out for a non-uuid check-in id', async () => {
    await request(app.getHttpServer())
      .patch('/api/gps/check-ins/not-a-uuid/check-out')
      .send({ latitude: 25, longitude: 55 })
      .expect(400);
  });

  it('rejects a location point with out-of-range coordinates (GPS-03.1)', async () => {
    await request(app.getHttpServer())
      .post('/api/gps/location-points')
      .send({ latitude: 25, longitude: 200 })
      .expect(400);
  });
});

describe('GPS summary (e2e)', () => {
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

  it('rejects a summary request with an invalid date string', async () => {
    await request(app.getHttpServer())
      .get('/api/gps/summary?dateFrom=not-a-date')
      .expect(400);
  });

  it('rejects a summary request with an invalid user id', async () => {
    await request(app.getHttpServer())
      .get('/api/gps/summary?userId=not-a-uuid')
      .expect(400);
  });
});
