import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { authContextMiddleware } from '../src/auth/auth-context.middleware';
import { rejectForeignOrigins } from '../src/auth/origin-check.middleware';
import type { AppConfig } from '../src/config/configuration';
import { UserRole } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/** A supertest agent that carries the session cookie on every request it makes. */
export type E2EAgent = ReturnType<typeof request.agent>;

/** Who the contract tests act as. No such user row has to exist — see below. */
const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Answers the guard's per-request account lookup (SEC-04) with a live account, whatever the
 * token names: there is no database here. Only the guard's call is answered, the one lookup that
 * filters on role, team and isActive together; every other `user.findFirst` reaches Prisma as
 * before, so no service is handed a user that does not exist. Returns the stub, so a spec can
 * make the account vanish or the lookup fail. The lookup's filter is covered by the guard's unit
 * spec and, against PostgreSQL, by the scratch validation.
 */
export function stubLiveAccounts(moduleRef: TestingModule) {
  const users = moduleRef.get(PrismaService).user;
  const findFirst = users.findFirst.bind(users) as (
    args?: object,
  ) => Promise<unknown>;
  return jest.spyOn(users, 'findFirst').mockImplementation(((args?: {
    where?: Record<string, unknown>;
  }) => {
    const where = args?.where ?? {};
    return 'role' in where && 'team' in where && where.isActive === true
      ? Promise.resolve({ id: E2E_USER_ID })
      : findFirst(args);
  }) as never);
}

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
 * Nothing here touches the database: the guard reads the claims off the token, its account
 * lookup is stubbed (`stubLiveAccounts`), and CurrentUserService resolves the claims from the
 * per-request store, so the user id need not exist. That matters, because the Prisma driver
 * adapter does not run under the Jest VM (see STATUS.md) — every assertion in these specs is
 * resolved by a guard or a pipe.
 */
export async function createE2EApp(
  role: UserRole = UserRole.SUPERADMIN,
): Promise<{
  app: INestApplication<App>;
  api: E2EAgent;
  account: ReturnType<typeof stubLiveAccounts>;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const account = stubLiveAccounts(moduleRef);

  const app: INestApplication<App> = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(
    rejectForeignOrigins(
      moduleRef.get(ConfigService).getOrThrow<AppConfig>('app').corsOrigin,
    ),
  );
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

  return { app, api, account };
}
