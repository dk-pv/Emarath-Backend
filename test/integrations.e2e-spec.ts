import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/generated/prisma/client';

const UUID = '11111111-1111-1111-1111-111111111111';

/**
 * Contract test for the integration registry API (INT-01.1).
 *
 * Exercises the guard/pipe layer end-to-end over real HTTP: authentication, the
 * SUPERADMIN role gate on enablement (INT-02.2 AC5), and body/param validation. Every
 * assertion here is resolved before the service reaches the database — the Prisma driver
 * adapter does not run under the Jest VM (see STATUS.md), so the persistence behaviour
 * is covered by the service unit specs instead.
 *
 * Unlike the older e2e specs in this folder, this one mounts `cookie-parser` and mints a
 * real signed token, because the global JwtAuthGuard reads the session from a cookie.
 */
describe('Integration registry (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    app.setGlobalPrefix('api');
    app.use(cookieParser());
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

  /** A signed access token for `role`, exactly as AuthService issues one. */
  const session = async (role: UserRole): Promise<string> =>
    `access_token=${await jwt.signAsync({ sub: UUID, role, team: 'Sales' })}`;

  describe('authentication', () => {
    it('401s an unauthenticated read', async () => {
      await request(app.getHttpServer()).get('/api/integrations').expect(401);
    });

    it('401s an unauthenticated toggle', async () => {
      await request(app.getHttpServer())
        .patch(`/api/integrations/${UUID}`)
        .send({ enabled: true })
        .expect(401);
    });
  });

  describe('role gate (INT-02.2 AC5)', () => {
    it('403s a sales agent toggling an integration', async () => {
      await request(app.getHttpServer())
        .patch(`/api/integrations/${UUID}`)
        .set('Cookie', await session(UserRole.SALES_AGENT))
        .send({ enabled: true })
        .expect(403);
    });

    it('403s a sales manager toggling an integration', async () => {
      await request(app.getHttpServer())
        .patch(`/api/integrations/${UUID}`)
        .set('Cookie', await session(UserRole.SALES_MANAGER))
        .send({ enabled: true })
        .expect(403);
    });

    // This is the one case that reaches the service, so Prisma logs an
    // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG error to the console — the Jest VM
    // limitation described above, not a failure. The assertion is deliberately about
    // what the guards did, not what the database could not do.
    it('does not 403 a superadmin — the role gate lets the request through', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/integrations/${UUID}`)
        .set('Cookie', await session(UserRole.SUPERADMIN))
        .send({ enabled: true });

      expect(response.status).not.toBe(403);
      expect(response.status).not.toBe(401);
    });
  });

  describe('validation', () => {
    it('400s a non-uuid integration id', async () => {
      await request(app.getHttpServer())
        .patch('/api/integrations/not-a-uuid')
        .set('Cookie', await session(UserRole.SUPERADMIN))
        .send({ enabled: true })
        .expect(400);
    });

    it('400s a non-boolean enabled flag', async () => {
      await request(app.getHttpServer())
        .patch(`/api/integrations/${UUID}`)
        .set('Cookie', await session(UserRole.SUPERADMIN))
        .send({ enabled: 'yes' })
        .expect(400);
    });

    it('400s a body carrying an unknown field', async () => {
      await request(app.getHttpServer())
        .patch(`/api/integrations/${UUID}`)
        .set('Cookie', await session(UserRole.SUPERADMIN))
        .send({ enabled: true, category: 'Meta' })
        .expect(400);
    });

    it('400s an empty body', async () => {
      await request(app.getHttpServer())
        .patch(`/api/integrations/${UUID}`)
        .set('Cookie', await session(UserRole.SUPERADMIN))
        .send({})
        .expect(400);
    });
  });
});
