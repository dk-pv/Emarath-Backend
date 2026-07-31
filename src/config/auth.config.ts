import { registerAs } from '@nestjs/config';

/**
 * Authentication configuration (ADR-0029). Kept in its own `auth` namespace and
 * consumed via `ConfigService.get<AuthConfig>('auth')` so application code never
 * reads `process.env` directly (CLAUDE.md §5).
 *
 * The JWT secret is required in production and refuses to boot without one; in
 * development it falls back to a clearly-insecure default so local work needs no
 * setup, mirroring how the dev auth shim fails closed in production.
 */
export interface AuthConfig {
  /** HS256 signing secret for the access token. */
  jwtAccessSecret: string;
  /** Access-token lifetime in seconds (short-lived — ADR §2.3). */
  jwtAccessTtlSec: number;
  /** Refresh-token lifetime in seconds (long-lived — ADR §3.2). */
  refreshTtlSec: number;
  /** Password-reset link lifetime in seconds (AUTH-03.1 — single-use + short-lived). */
  resetTokenTtlSec: number;
  /** Max login attempts per window (AUTH-01.2 AC3). */
  loginRateLimit: number;
  /** Rate-limit window in milliseconds. */
  loginRateTtlMs: number;
  /** `Secure` cookie flag — on outside development. */
  cookieSecure: boolean;
  /** `SameSite` cookie policy (ADR §4.1). */
  cookieSameSite: 'lax' | 'strict' | 'none';
}

const DEV_INSECURE_SECRET = 'dev-insecure-access-secret-change-me';

export default registerAs('auth', (): AuthConfig => {
  const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';
  const secret = process.env.JWT_ACCESS_SECRET;
  if (isProduction && !secret) {
    throw new Error('JWT_ACCESS_SECRET must be set in production.');
  }

  const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase();
  if (sameSite !== 'lax' && sameSite !== 'strict' && sameSite !== 'none') {
    throw new Error(`Invalid COOKIE_SAMESITE "${sameSite}".`);
  }

  return {
    jwtAccessSecret: secret ?? DEV_INSECURE_SECRET,
    jwtAccessTtlSec: Number.parseInt(
      process.env.JWT_ACCESS_TTL_SEC ?? '900',
      10,
    ),
    refreshTtlSec: Number.parseInt(process.env.REFRESH_TTL_SEC ?? '604800', 10),
    resetTokenTtlSec: Number.parseInt(
      process.env.RESET_TOKEN_TTL_SEC ?? '3600',
      10,
    ),
    loginRateLimit: Number.parseInt(process.env.LOGIN_RATE_LIMIT ?? '10', 10),
    loginRateTtlMs: Number.parseInt(
      process.env.LOGIN_RATE_TTL_MS ?? '60000',
      10,
    ),
    cookieSecure: isProduction,
    cookieSameSite: sameSite,
  };
});
