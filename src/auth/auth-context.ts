import { AsyncLocalStorage } from 'node:async_hooks';
import type { CurrentUser } from './current-user';

/** Per-request store holding the authenticated caller (populated by JwtAuthGuard). */
export interface AuthStore {
  user?: CurrentUser;
}

/**
 * Carries the authenticated user across the async request pipeline without making
 * every consumer request-scoped (AUTH-01.4). A global middleware opens a store per
 * request, the guard fills it, and JwtCurrentUserService — a singleton — reads it.
 * Node's built-in AsyncLocalStorage, so no dependency.
 */
export const authContext = new AsyncLocalStorage<AuthStore>();
