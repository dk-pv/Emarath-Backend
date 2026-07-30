import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { authContextMiddleware } from './auth/auth-context.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');
  app.setGlobalPrefix(appConfig.apiPrefix);
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
