import { Global, Module } from '@nestjs/common';
import { CurrentUserService } from './current-user';
import { DevelopmentCurrentUserService } from './development-current-user.service';

/**
 * Owns "who is asking".
 *
 * The binding below is the single seam AUTH-01.3 replaces: point
 * `CurrentUserService` at a JWT-backed implementation and every feature module
 * that scopes by user follows, without editing any of them.
 */
@Global()
@Module({
  providers: [
    { provide: CurrentUserService, useClass: DevelopmentCurrentUserService },
  ],
  exports: [CurrentUserService],
})
export class AuthModule {}
