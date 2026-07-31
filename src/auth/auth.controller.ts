import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, type PublicUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from './public.decorator';
import type { AuthConfig } from '../config/auth.config';
import type { AppConfig } from '../config/configuration';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

/**
 * Authentication routes (AUTH-01.2 login + AUTH-01.3 refresh). `@Public()` — these are
 * how a caller obtains a session, so the JwtAuthGuard (AUTH-01.4) must not gate them;
 * they stay rate-limited by the ThrottlerGuard. Logout is AUTH-01.5.
 */
@Controller('auth')
@Public()
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verify credentials and start a session (AUTH-01.2 AC1 / AUTH-01.3 AC1). Issues an
   * access token and a refresh token, both as HttpOnly cookies (ADR §4/§8.2 — never in a
   * JS-readable body); the body carries the basic profile only, with no hash (AC5).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const session = await this.auth.login(dto, req.headers['user-agent']);
    this.setSessionCookies(res, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  /**
   * Exchange the refresh cookie for a fresh access token and a rotated refresh token
   * (AUTH-01.3 AC3/AC5). A missing/invalid/expired/reused token is a generic 401 (AC4).
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const rawToken = cookies[REFRESH_COOKIE];
    if (!rawToken) {
      throw new UnauthorizedException('Invalid session.');
    }
    const session = await this.auth.refresh(
      rawToken,
      req.headers['user-agent'],
    );
    this.setSessionCookies(res, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  /**
   * End the session (AUTH-01.5). Revokes the presented refresh token's family so it can no
   * longer refresh (AC1/AC4), then clears both cookies (AC2). Idempotent — succeeds with no
   * cookies present and when called repeatedly, and never leaks whether a token existed.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    await this.auth.logout(cookies[REFRESH_COOKIE]);
    this.clearSessionCookies(res);
    return { success: true };
  }

  /**
   * Begin password recovery (AUTH-03.1 AC1/AC2). Always returns the same generic success,
   * whether or not the email is registered, so the response never reveals account
   * existence. Public + rate-limited like the other auth routes.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ success: true }> {
    await this.auth.requestPasswordReset(dto.email);
    return { success: true };
  }

  /**
   * Complete password recovery (AUTH-03.1 AC3/AC4/AC5). A valid, unused, unexpired token
   * sets the new password and revokes existing sessions; a used/expired/invalid token is a
   * generic 401, and a weak password is a 400 from the DTO.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ success: true }> {
    await this.auth.resetPassword(dto.token, dto.password);
    return { success: true };
  }

  /**
   * Deliver both tokens as HttpOnly cookies. The access cookie is sent to every `/api`
   * route; the refresh cookie is scoped to `/api/auth`, so it only rides along to the
   * auth routes that consume it.
   */
  private setSessionCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    const auth = this.config.getOrThrow<AuthConfig>('auth');
    const app = this.config.getOrThrow<AppConfig>('app');
    const base = {
      httpOnly: true,
      secure: auth.cookieSecure,
      sameSite: auth.cookieSameSite,
    } as const;

    res.cookie(ACCESS_COOKIE, accessToken, {
      ...base,
      path: `/${app.apiPrefix}`,
      maxAge: auth.jwtAccessTtlSec * 1000,
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...base,
      path: `/${app.apiPrefix}/auth`,
      maxAge: auth.refreshTtlSec * 1000,
    });
  }

  /**
   * Clear both session cookies. Path + attributes must match `setSessionCookies` exactly,
   * or the browser keeps the originals (a cookie is identified by name + path).
   */
  private clearSessionCookies(res: Response): void {
    const auth = this.config.getOrThrow<AuthConfig>('auth');
    const app = this.config.getOrThrow<AppConfig>('app');
    const base = {
      httpOnly: true,
      secure: auth.cookieSecure,
      sameSite: auth.cookieSameSite,
    } as const;

    res.clearCookie(ACCESS_COOKIE, { ...base, path: `/${app.apiPrefix}` });
    res.clearCookie(REFRESH_COOKIE, {
      ...base,
      path: `/${app.apiPrefix}/auth`,
    });
  }
}
