import { registerAs } from '@nestjs/config';

/**
 * Logical application environments supported by Emarath.
 *
 * NOTE: This is the *business* environment and is driven by `NODE_ENV`.
 * Jest sets `NODE_ENV=test`, which we treat as `development` so that the
 * test suite does not fail on environment validation.
 */
export type AppEnvironment = 'development' | 'staging' | 'production';

export interface AppConfig {
  /** Human-readable service name. */
  name: string;
  /** Selected application environment. */
  environment: AppEnvironment;
  /** TCP port the HTTP server listens on. */
  port: number;
  /** Global route prefix (health check is served at `/<apiPrefix>/health`). */
  apiPrefix: string;
  /**
   * Allowed CORS origins (the frontend URLs). A list, because the dev frontend moves
   * between ports — Next falls back to 3001 when something else holds 3000 — and a
   * single pinned origin means every such move breaks login until the env is edited.
   */
  corsOrigin: string[];
}

const VALID_ENVIRONMENTS: AppEnvironment[] = [
  'development',
  'staging',
  'production',
];

function resolveEnvironment(): AppEnvironment {
  const raw = (process.env.NODE_ENV ?? 'development').toLowerCase();
  // Jest and other tooling use NODE_ENV=test; map it to development.
  const normalized = raw === 'test' ? 'development' : raw;

  if (!VALID_ENVIRONMENTS.includes(normalized as AppEnvironment)) {
    throw new Error(
      `Invalid NODE_ENV "${process.env.NODE_ENV}". ` +
        `Expected one of: ${VALID_ENVIRONMENTS.join(', ')} (or "test").`,
    );
  }

  return normalized as AppEnvironment;
}

function resolvePort(): number {
  const raw = process.env.PORT ?? '5001';
  const port = Number.parseInt(raw, 10);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT "${raw}". Expected a positive integer.`);
  }

  return port;
}

/**
 * Centralised application configuration.
 *
 * Registered under the `app` namespace and consumed via
 * `ConfigService.get<AppConfig>('app')` so that application code never reads
 * `process.env` directly.
 */
/**
 * The CORS allow-list from `CORS_ORIGIN`: one origin, or several separated by commas.
 * Blank entries are dropped so a trailing comma is harmless. Defaults to the two ports
 * `next dev` actually uses locally, so a fresh clone works whichever one it lands on.
 */
function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return ['http://localhost:3000', 'http://localhost:3001'];
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0
    ? origins
    : ['http://localhost:3000', 'http://localhost:3001'];
}

export default registerAs('app', (): AppConfig => ({
  name: process.env.APP_NAME ?? 'Emarath Backend',
  environment: resolveEnvironment(),
  port: resolvePort(),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: resolveCorsOrigins(),
}));
