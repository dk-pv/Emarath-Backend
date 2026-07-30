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
import type { AuthConfig } from '../config/auth.config';
import type { AppConfig } from '../config/configuration';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

/**
 * Authentication routes (AUTH-01.2 login + AUTH-01.3 refresh). Rate-limited with
 * @nestjs/throttler (the ThrottlerGuard here is the rate-limiter, NOT the JWT route
 * guard, which is AUTH-01.4). Logout is AUTH-01.5.
 */
@Controller('auth')
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
}
