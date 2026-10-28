import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { authContext } from './auth-context';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
 * (AC1/AC4/AC5); a missing, invalid, expired or tampered token is a standard 401, and so
 * is a token whose account no longer matches it (SEC-04).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

    // team rides as a signed claim (ADR-0030 §4); a token without one reads as no team. The
    // claims become a database filter below, so only the shapes AuthService signs get through:
    // an object would be read as a Prisma filter, and a malformed id fails the query.
    const { sub, role, team = null } = payload;
    if (
      !sub ||
      !isUUID(sub, 'loose') ||
      !role ||
      !Object.values(UserRole).includes(role) ||
      (team !== null && typeof team !== 'string')
    ) {
      throw new UnauthorizedException('Invalid session.');
    }

    // A valid token proves who signed in, not that the account still allows it (SEC-04). One
    // primary-key read per request refuses the token once its user is deleted or deactivated,
    // or holds another role or team than it says. The client's next refresh re-reads the
    // account, so a changed role or team costs one silent renewal and a removed account ends
    // there. Never cached, so a deactivation applies from the next request; a database error
    // propagates, so no request passes unverified.
    const account = await this.prisma.user.findFirst({
      where: { id: sub, role, team, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!account) {
      throw new UnauthorizedException('Invalid session.');
    }

    const user: CurrentUser = { id: sub, role, team };
    request.user = user;
    const store = authContext.getStore();
    if (store) {
      store.user = user;
    }
    return true;
  }
}
