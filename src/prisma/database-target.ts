import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

/**
 * Where a Postgres URL points, and whether that is this machine (ADR-0095). The seeds and the e2e
 * suite ask this before they open any connection: a database on another host may be the shared
 * development database or production, so nothing that writes fixtures or runs tests reaches one
 * by accident. `prisma/database-target.mjs` mirrors it for `seed-calls.mjs`, which runs unbuilt.
 */
export interface DatabaseTarget {
  host: string;
  database: string;
  local: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Null when `url` is not a postgres URL this check can read, which callers treat as remote. */
export function databaseTarget(url: string): DatabaseTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return null;
  }
  // node-postgres lets a `host` query parameter replace the URL's host, so that is the host it
  // would really connect to. No host at all falls back to PGHOST, which may be anywhere. Given
  // several, it takes the last, so such a URL is refused rather than read one way or the other.
  const hosts = parsed.searchParams.getAll('host');
  if (hosts.length > 1) {
    return null;
  }
  const host = (hosts[0] ?? parsed.hostname)
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  const local =
    LOCAL_HOSTS.has(host) ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith('/');
  return {
    host,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    local,
  };
}

/**
 * Names one remote database a seed may write to on purpose: exactly `<host>/<database>` of the
 * URL it connects to. Meant for a single run, set in the shell — never kept in `.env`.
 */
export const SEED_REMOTE_OVERRIDE = 'SEED_ALLOW_REMOTE_DATABASE';

/**
 * Refuses, before the seed opens a connection, any target that is not on this machine. A seed
 * that bootstraps an environment (`overridable`) may still write to the one remote database that
 * `SEED_ALLOW_REMOTE_DATABASE` names; fixtures and bulk test data never can. That override comes
 * from the shell, for one run: one kept in `.env` (`envFile`, the file dotenv loads) is refused.
 * The URL is never echoed: it carries credentials, and the host is the operator's to know.
 */
export function assertSeedTarget(
  script: string,
  url: string | undefined,
  options: { overridable: boolean },
  env: NodeJS.ProcessEnv = process.env,
  envFile = resolve(process.cwd(), '.env'),
): void {
  const target = url ? databaseTarget(url) : null;
  if (target?.local) return;
  // dotenv has already copied `.env` into the environment, so only the file itself shows that
  // the override would apply to every run rather than this one.
  if (
    options.overridable &&
    target &&
    env[SEED_REMOTE_OVERRIDE] !== undefined &&
    existsSync(envFile) &&
    SEED_REMOTE_OVERRIDE in parse(readFileSync(envFile))
  ) {
    throw new Error(
      `${script} refuses to run: ${SEED_REMOTE_OVERRIDE} is set in .env, where it would apply to every run. Remove it from .env and set it in the shell for the one run that needs it.`,
    );
  }
  if (
    options.overridable &&
    target &&
    env[SEED_REMOTE_OVERRIDE] === `${target.host}/${target.database}`
  ) {
    return;
  }
  throw new Error(
    !url
      ? `${script}: no database URL is set.`
      : !target
        ? `${script} refuses to run: its database URL is not a postgres URL with one host that this guard can check.`
        : options.overridable
          ? `${script} refuses to run against a database on another host. To seed that one database on purpose, set ${SEED_REMOTE_OVERRIDE} to its <host>/<database> for this run.`
          : `${script} refuses to run against a database on another host: it only seeds a disposable database on this machine.`,
  );
}

/** What the e2e suite connects to when no local test database is configured: a closed port. */
export const ISOLATED_E2E_DATABASE_URL =
  'postgresql://e2e:e2e@127.0.0.1:9/e2e_isolated';

/**
 * Gives the e2e suite its database before the app's ConfigModule reads `.env`, which never
 * replaces a variable already set: `E2E_DATABASE_URL` when it points at this machine, otherwise
 * the closed port above — the contract tests need no database. Every `*DATABASE_URL*` variable
 * gets it, so a remote URL in `.env` or the shell is never used, and a remote `E2E_DATABASE_URL`
 * stops the suite before anything connects.
 */
export function isolateE2eDatabase(env: NodeJS.ProcessEnv): string {
  const configured = env.E2E_DATABASE_URL;
  if (configured && !databaseTarget(configured)?.local) {
    throw new Error(
      'E2E_DATABASE_URL must point at a disposable database on this machine (localhost, 127.0.0.1 or ::1); the e2e suite never connects to another host.',
    );
  }
  const url = configured || ISOLATED_E2E_DATABASE_URL;
  const keys = Object.keys(env).filter(
    (key) => key.includes('DATABASE_URL') && key !== 'E2E_DATABASE_URL',
  );
  for (const key of new Set([
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
    ...keys,
  ])) {
    env[key] = url;
  }
  return url;
}
