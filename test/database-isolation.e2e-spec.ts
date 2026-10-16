import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createE2EApp } from './e2e-app';
import { databaseTarget } from '../src/prisma/database-target';

/**
 * The e2e suite never reaches the developer's database (ADR-0095): `e2e-env.ts` sets every
 * database URL before the app loads, and ConfigModule does not replace a variable that is
 * already set — so the URL PrismaService connects with is local whatever `.env` holds.
 */
describe('e2e database isolation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives the app a database on this machine, never the one .env names', () => {
    const config = app.get(ConfigService);
    for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
      const url = config.get<string>(key);
      expect(url && databaseTarget(url)?.local).toBe(true);
    }
  });
});
