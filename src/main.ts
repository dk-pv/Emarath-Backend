import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { authContextMiddleware } from './auth/auth-context.middleware';
import { rejectForeignOrigins } from './auth/origin-check.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');
  // Hosted, every request reaches the API through the platform's proxy, so without this the
  // client address — and the login throttle keyed on it — would be the proxy's, one bucket for
  // everyone. One hop: Express takes the address that proxy appended to X-Forwarded-For and
  // ignores any entries the client wrote itself. Development runs without a proxy.
  if (appConfig.environment !== 'development') app.set('trust proxy', 1);
  app.setGlobalPrefix(appConfig.apiPrefix);
  // Before body parsing and every guard: a write from a page on another site is refused (CSRF).
  app.use(rejectForeignOrigins(appConfig.corsOrigin));
  // Populates req.cookies so the guard/refresh route can read the HttpOnly cookies
  // (AUTH-01.3/01.4). Reading only — cookies are set via res.cookie in the controller.
  app.use(cookieParser());
  // Opens a per-request auth store the JwtAuthGuard fills and CurrentUserService reads
  // (AUTH-01.4). Runs after cookie parsing so the guard sees req.cookies.
  app.use(authContextMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: appConfig.corsOrigin,
    credentials: true,
  });

  await app.listen(appConfig.port);

  Logger.log(
    `Emarath backend [${appConfig.environment}] listening on ` +
      `http://localhost:${appConfig.port}/${appConfig.apiPrefix}`,
    'Bootstrap',
  );
}

void bootstrap();
