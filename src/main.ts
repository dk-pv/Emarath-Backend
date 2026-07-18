import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');

  // Consistent global API prefix -> health check served at /<apiPrefix>/health.
  app.setGlobalPrefix(appConfig.apiPrefix);

  // Input is rejected before it reaches a controller, and an unrecognised
  // parameter is an error rather than something quietly dropped: a mistyped
  // filter must not return the unfiltered list while looking like it worked.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Allow the Emarath frontend to reach the API (e.g. the health check).
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
