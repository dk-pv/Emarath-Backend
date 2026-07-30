import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { CurrentUserService } from './current-user';
import { DevelopmentCurrentUserService } from './development-current-user.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import type { AuthConfig } from '../config/auth.config';

/**
 * Owns "who is asking" and, from AUTH-01.2, login.
 *
 * The CurrentUserService binding below is the single seam AUTH-01.3 replaces with a
 * JWT-backed implementation. JwtModule signs the access token; ThrottlerModule rate-
 * limits login (AC3). Refresh, guards and logout are later tasks.
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
    { provide: CurrentUserService, useClass: DevelopmentCurrentUserService },
  ],
  exports: [CurrentUserService],
})
export class AuthModule {}
