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
  /** Allowed CORS origin (the frontend URL). */
  corsOrigin: string;
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
  const raw = process.env.PORT ?? '5000';
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
export default registerAs('app', (): AppConfig => ({
  name: process.env.APP_NAME ?? 'Emarath Backend',
  environment: resolveEnvironment(),
  port: resolvePort(),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
}));
