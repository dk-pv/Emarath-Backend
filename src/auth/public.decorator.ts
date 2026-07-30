import { SetMetadata } from '@nestjs/common';

/** Metadata key marking a route (or controller) as reachable without authentication. */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Exempts a route or controller from JwtAuthGuard (AUTH-01.4). Applied to login,
 * refresh and health — everything else is protected by default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
