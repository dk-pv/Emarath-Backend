import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CurrentUser, CurrentUserService } from './current-user';
import { authContext } from './auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { withPipelineAccess } from '../pipelines/pipeline-access';

/**
 * Resolves the caller from the per-request auth store the JwtAuthGuard populated
 * (AUTH-01.4). Replaces the development shim: identity now comes from the verified
 * access token, not a seeded account. A singleton — the request user travels via
 * AsyncLocalStorage, so no feature service becomes request-scoped, and every module
 * that depends on the CurrentUserService abstraction is unchanged.
 *
 * The pipelines closed to the caller come from the database, not the token (ADR-0093): the
 * first resolve in a request looks them up and every later one in that request shares the
 * answer, so a grant changed in Settings applies from the caller's next request.
 */
@Injectable()
export class JwtCurrentUserService extends CurrentUserService {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  resolve(): Promise<CurrentUser> {
    const store = authContext.getStore();
    if (!store?.user) {
      return Promise.reject(new UnauthorizedException('Not authenticated.'));
    }
    store.resolved ??= withPipelineAccess(this.prisma, store.user);
    return store.resolved;
  }
}
