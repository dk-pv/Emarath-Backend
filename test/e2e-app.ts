import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { authContextMiddleware } from '../src/auth/auth-context.middleware';
import { UserRole } from '../src/generated/prisma/client';

/** A supertest agent that carries the session cookie on every request it makes. */
export type E2EAgent = ReturnType<typeof request.agent>;

/** Who the contract tests act as. No such user row has to exist — see below. */
const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * The app as `main.ts` assembles it — global prefix, cookie parser, per-request auth
 * store, validation pipe — plus an agent already holding a signed session.
 *
 * The session is the point. `JwtAuthGuard` is registered as an APP_GUARD and reads the
 * `access_token` cookie, and Nest runs guards before pipes: a request with no cookie is
 * a 401 from the guard and never reaches the validation these specs exist to test. The
 * token is minted by the app's own JwtService, so it carries the issuer, audience and
 * expiry the guard verifies, and SUPERADMIN clears the `@Roles` gates on the bulk and
 * row-action routes.
 *
 * Nothing here touches the database: the guard reads the claims off the token and
 * CurrentUserService resolves them from the per-request store, so the user id need not
 * exist. That matters, because the Prisma driver adapter does not run under the Jest VM
 * (see STATUS.md) — every assertion in these specs is resolved by a guard or a pipe.
 */
export async function createE2EApp(
  role: UserRole = UserRole.SUPERADMIN,
): Promise<{ app: INestApplication<App>; api: E2EAgent }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication<App> = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(authContextMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();

  const token = await moduleRef
    .get(JwtService)
    .signAsync({ sub: E2E_USER_ID, role, team: 'Sales' });
  const api = request
    .agent(app.getHttpServer())
    .set('Cookie', `access_token=${token}`);

  return { app, api };
}
