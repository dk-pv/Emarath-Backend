import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import type { CurrentUser } from './current-user';
import { UserRole } from '../generated/prisma/client';

/**
 * Authorises a request against the @Roles() metadata (AUTH-02.2). Registered as an
 * APP_GUARD after JwtAuthGuard, so `request.user` is already populated. A route without
 * @Roles() is allowed (default-open — those are governed by data scoping, not by role);
 * a route with @Roles() admits only a listed role and 403s everyone else. That server
 * block is what actually enforces a restriction the UI merely hides (AC4): a role denial
 * is a 403 (you are known, you may not), distinct from scoping's 404 (you may not know it
 * exists).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUser }>();
    const role = request.user?.role;
    if (!role || !roles.includes(role)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }
    return true;
  }
}
