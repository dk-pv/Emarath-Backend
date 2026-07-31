import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { authContext } from './auth-context';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';

const ACCESS_COOKIE = 'access_token';
const JWT_ISSUER = 'emarath-api';
const JWT_AUDIENCE = 'emarath-app';

interface AccessTokenPayload {
  sub?: string;
  role?: UserRole;
  team?: string | null;
}

/**
 * Authenticates every request from the access-token cookie (AUTH-01.4). Verifies the
 * JWT's signature, expiry, issuer and audience; on success attaches the resolved
 * `{ id, role }` to both the request and the per-request auth store, so
 * CurrentUserService resolves it (AC2). Routes marked `@Public()` skip the check.
 * Registered as APP_GUARD, so every feature route is protected by default
 * (AC1/AC4/AC5); a missing, invalid, expired or tampered token is a standard 401.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUser }>();
    const cookies = (request.cookies ?? {}) as Record<
      string,
      string | undefined
    >;
    const token = cookies[ACCESS_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Authentication required.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('Invalid session.');
    }

    // team rides as a signed claim (ADR-0030 §4). A token issued before AUTH-02.1 has none,
    // so `team` is null and a manager falls back to own-only (§7) until the next refresh.
    const user: CurrentUser = {
      id: payload.sub,
      role: payload.role,
      team: payload.team ?? null,
    };
    request.user = user;
    const store = authContext.getStore();
    if (store) {
      store.user = user;
    }
    return true;
  }
}
