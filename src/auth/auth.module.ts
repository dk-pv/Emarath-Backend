import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { CurrentUserService } from './current-user';
import { JwtCurrentUserService } from './jwt-current-user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import type { AuthConfig } from '../config/auth.config';

/**
 * Owns "who is asking", login and session refresh.
 *
 * From AUTH-01.4, CurrentUserService is JWT-backed: the global JwtAuthGuard verifies the
 * access cookie and populates the per-request identity, and JwtCurrentUserService reads
 * it — the CurrentUserService abstraction is unchanged, so no feature module edits.
 * JwtModule signs/verifies the access token; ThrottlerModule rate-limits login. Logout is
 * AUTH-01.5.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AuthConfig>('auth');
        return {
          secret: auth.jwtAccessSecret,
          signOptions: {
            expiresIn: auth.jwtAccessTtlSec,
            issuer: 'emarath-api',
            audience: 'emarath-app',
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AuthConfig>('auth');
        return [{ ttl: auth.loginRateTtlMs, limit: auth.loginRateLimit }];
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokenService,
    { provide: CurrentUserService, useClass: JwtCurrentUserService },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [CurrentUserService],
})
export class AuthModule {}
