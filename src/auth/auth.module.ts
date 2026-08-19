import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { CurrentUserService } from './current-user';
import { JwtCurrentUserService } from './jwt-current-user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { PasswordResetService } from './password-reset.service';
import {
  LogMailerService,
  MailerService,
  ResendMailerService,
} from './mailer.service';
import type { AuthConfig } from '../config/auth.config';
import type { MailConfig } from '../config/mail.config';

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
    PasswordResetService,
    // The mail transport is chosen by environment (ADR-0031): log in development/test,
    // Resend in staging/production. Selecting one adapter here keeps feature code unaware
    // of the provider — a swap is one branch, not a code change.
    {
      provide: MailerService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailerService => {
        const { provider } = config.getOrThrow<MailConfig>('mail');
        return provider === 'resend'
          ? new ResendMailerService(config)
          : new LogMailerService();
      },
    },
    { provide: CurrentUserService, useClass: JwtCurrentUserService },
    // Order matters: JwtAuthGuard authenticates and sets request.user, then RolesGuard
    // authorises against @Roles() metadata (AUTH-02.2). Global guards run in the order
    // they are registered here.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // MailerService is exported (AuthModule is @Global) so outreach features reuse the one
  // configured transport — the Lead Email composer (ADR-0032) injects it, no second mailer.
  exports: [CurrentUserService, MailerService],
})
export class AuthModule {}
