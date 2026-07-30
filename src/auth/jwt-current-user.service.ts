import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CurrentUser, CurrentUserService } from './current-user';
import { authContext } from './auth-context';

/**
 * Resolves the caller from the per-request auth store the JwtAuthGuard populated
 * (AUTH-01.4). Replaces the development shim: identity now comes from the verified
 * access token, not a seeded account. A singleton — the request user travels via
 * AsyncLocalStorage, so no feature service becomes request-scoped, and every module
 * that depends on the CurrentUserService abstraction is unchanged.
 */
@Injectable()
export class JwtCurrentUserService extends CurrentUserService {
  resolve(): Promise<CurrentUser> {
    const store = authContext.getStore();
    return store?.user
      ? Promise.resolve(store.user)
      : Promise.reject(new UnauthorizedException('Not authenticated.'));
  }
}
