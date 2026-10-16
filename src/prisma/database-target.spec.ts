import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ISOLATED_E2E_DATABASE_URL,
  SEED_REMOTE_OVERRIDE,
  assertSeedTarget,
  databaseTarget,
  isolateE2eDatabase,
} from './database-target';

/*
  The seeds and the e2e suite refuse any database that is not on this machine, before they open a
  connection (ADR-0095). These cases are the whole rule; the .mjs twin used by seed-calls.mjs must
  answer every one of them the same way.
*/

/** A URL naming two hosts, in both orders. node-postgres would connect to the last one. */
const TWO_HOSTS = [
  'postgresql://u@localhost/app?host=localhost&host=db.example.com',
  'postgresql://u@localhost/app?host=db.example.com&host=localhost',
];

const CASES: [string, boolean][] = [
  ['postgresql://user:pw@localhost:5432/app', true],
  ['postgres://user:pw@127.0.0.1/app', true],
  ['postgresql://user:pw@127.0.0.5:55432/app', true],
  ['postgresql://user:pw@[::1]:5432/app', true],
  ['postgresql:///app?host=/var/run/postgresql', true],
  // Credentials without a host are not a URL the parser accepts, so they count as remote.
  ['postgresql://user@/app?host=/var/run/postgresql', false],
  ['postgresql://user:pw@db.example.com:5432/app', false],
  // node-postgres connects to the `host` parameter, not the URL's host.
  ['postgresql://user:pw@localhost:5432/app?host=db.example.com', false],
  ['postgresql://user:pw@db.example.com/app?host=localhost', true],
  // Two `host` parameters are refused, whichever one is local.
  ...TWO_HOSTS.map((url): [string, boolean] => [url, false]),
  ['postgresql://user:pw@localhost.example.com/app', false],
  ['postgresql://user:pw@127.0.0.1.example.com/app', false],
  // No host means PGHOST, which may be anywhere.
  ['postgresql:///app', false],
  ['mysql://user:pw@localhost/app', false],
  ['not a url', false],
];

const REMOTE =
  'postgresql://seeder:not-a-real-password@db.example.com:5432/shared';

describe('databaseTarget', () => {
  it.each(CASES)('%s is local: %s', (url, local) => {
    expect(databaseTarget(url)?.local ?? false).toBe(local);
  });

  it('names the host and database the override must match', () => {
    expect(databaseTarget(REMOTE)).toEqual({
      host: 'db.example.com',
      database: 'shared',
      local: false,
    });
  });
});

describe('assertSeedTarget', () => {
  const local = 'postgresql://seeder:pw@127.0.0.1:55432/scratch';
  // A .env that does not exist, so no case here reads the developer's own.
  const NO_DOTENV = join(tmpdir(), 'emarath-no-dotenv', '.env');

  it('lets every seed write to a database on this machine', () => {
    expect(() =>
      assertSeedTarget('seed', local, { overridable: false }, {}),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget('seed', local, { overridable: true }, {}),
    ).not.toThrow();
  });

  it('refuses a remote database without the override', () => {
    expect(() =>
      assertSeedTarget('seed', REMOTE, { overridable: true }, {}),
    ).toThrow(/refuses to run against a database on another host/);
  });

  it('accepts the one remote database the override names, for a seed that allows it', () => {
    const env = { [SEED_REMOTE_OVERRIDE]: 'db.example.com/shared' };
    expect(() =>
      assertSeedTarget('seed', REMOTE, { overridable: true }, env, NO_DOTENV),
    ).not.toThrow();
  });

  it('refuses an override kept in .env, which would apply to every run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-guard-'));
    const file = join(dir, '.env');
    const env = { [SEED_REMOTE_OVERRIDE]: 'db.example.com/shared' };
    const seed = () =>
      assertSeedTarget('seed', REMOTE, { overridable: true }, env, file);
    try {
      writeFileSync(file, 'NODE_ENV=development\n');
      expect(seed).not.toThrow();
      writeFileSync(file, `${SEED_REMOTE_OVERRIDE}=db.example.com/shared\n`);
      expect(seed).toThrow(/is set in \.env/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never lets the override reach a fixture seed', () => {
    const env = { [SEED_REMOTE_OVERRIDE]: 'db.example.com/shared' };
    expect(() =>
      assertSeedTarget('seed-dev-dataset', REMOTE, { overridable: false }, env),
    ).toThrow(/only seeds a disposable database on this machine/);
  });

  it.each([
    'db.example.com',
    'db.example.com/other',
    'other.example.com/shared',
    '*',
  ])('refuses an override that names a different target (%s)', (named) => {
    const env = { [SEED_REMOTE_OVERRIDE]: named };
    expect(() =>
      assertSeedTarget('seed', REMOTE, { overridable: true }, env, NO_DOTENV),
    ).toThrow(/refuses to run/);
  });

  it.each(TWO_HOSTS)(
    'refuses %s, which names two hosts, even with an override for one',
    (url) => {
      const env = { [SEED_REMOTE_OVERRIDE]: 'db.example.com/app' };
      expect(() =>
        assertSeedTarget('seed', url, { overridable: true }, env, NO_DOTENV),
      ).toThrow(/not a postgres URL with one host/);
    },
  );

  it('refuses a missing or unreadable URL', () => {
    expect(() =>
      assertSeedTarget('seed', undefined, { overridable: true }, {}),
    ).toThrow(/no database URL is set/);
    expect(() =>
      assertSeedTarget('seed', 'not a url', { overridable: true }, {}),
    ).toThrow(/not a postgres URL/);
  });

  it('never echoes the URL, its credentials or its host', () => {
    let message = '';
    try {
      assertSeedTarget('seed', REMOTE, { overridable: true }, {});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('not-a-real-password');
    expect(message).not.toContain('db.example.com');
    expect(message).not.toContain('seeder');
  });
});

describe('isolateE2eDatabase', () => {
  it('replaces every remote database URL with a closed local port', () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: REMOTE,
      DATABASE_URL_UNPOOLED: REMOTE,
      SHADOW_DATABASE_URL: REMOTE,
    };
    expect(isolateE2eDatabase(env)).toBe(ISOLATED_E2E_DATABASE_URL);
    expect(env).toEqual({
      DATABASE_URL: ISOLATED_E2E_DATABASE_URL,
      DATABASE_URL_UNPOOLED: ISOLATED_E2E_DATABASE_URL,
      SHADOW_DATABASE_URL: ISOLATED_E2E_DATABASE_URL,
    });
    expect(databaseTarget(ISOLATED_E2E_DATABASE_URL)?.local).toBe(true);
  });

  it('sets both URLs when none is set, so .env cannot supply one', () => {
    const env: NodeJS.ProcessEnv = {};
    isolateE2eDatabase(env);
    expect(env.DATABASE_URL).toBe(ISOLATED_E2E_DATABASE_URL);
    expect(env.DATABASE_URL_UNPOOLED).toBe(ISOLATED_E2E_DATABASE_URL);
  });

  it('uses a local E2E_DATABASE_URL for every database URL', () => {
    const testDb = 'postgresql://e2e:pw@127.0.0.1:55432/e2e';
    const env: NodeJS.ProcessEnv = {
      E2E_DATABASE_URL: testDb,
      DATABASE_URL: REMOTE,
    };
    expect(isolateE2eDatabase(env)).toBe(testDb);
    expect(env.DATABASE_URL).toBe(testDb);
    expect(env.DATABASE_URL_UNPOOLED).toBe(testDb);
    expect(env.E2E_DATABASE_URL).toBe(testDb);
  });

  it('stops before anything connects when E2E_DATABASE_URL is remote', () => {
    const env: NodeJS.ProcessEnv = {
      E2E_DATABASE_URL: REMOTE,
      DATABASE_URL: REMOTE,
    };
    expect(() => isolateE2eDatabase(env)).toThrow(
      /must point at a disposable database on this machine/,
    );
  });

  it.each(TWO_HOSTS)(
    'stops before connecting when E2E_DATABASE_URL names two hosts (%s)',
    (url) => {
      expect(() => isolateE2eDatabase({ E2E_DATABASE_URL: url })).toThrow(
        /must point at a disposable database on this machine/,
      );
    },
  );
});

describe('prisma/database-target.mjs (used by seed-calls.mjs)', () => {
  const twin = pathToFileURL(
    resolve(__dirname, '../../prisma/database-target.mjs'),
  ).href;

  /** Runs `body` in a plain node ES module with the twin imported as `t`. */
  function runTwin(body: string): unknown {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const t = await import(${JSON.stringify(twin)}); ${body}`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.stderr).toBe('');
    return JSON.parse(result.stdout) as unknown;
  }

  it('answers every case the TypeScript check does', () => {
    const urls = CASES.map(([url]) => url);
    const answers = runTwin(
      `console.log(JSON.stringify(${JSON.stringify(urls)}.map((url) => t.isLocalDatabase(url))));`,
    );
    expect(answers).toEqual(CASES.map(([, local]) => local));
  });

  it('refuses a remote or missing URL and has no override', () => {
    const outcome = runTwin(`
      const tryIt = (url) => { try { t.assertLocalDatabase('seed-calls', url); return 'ran'; } catch (e) { return e.message; } };
      process.env.${SEED_REMOTE_OVERRIDE} = 'db.example.com/shared';
      console.log(JSON.stringify([
        tryIt(${JSON.stringify(REMOTE)}),
        tryIt(undefined),
        tryIt('postgresql://u:pw@127.0.0.1:55432/scratch'),
      ]));
    `);
    expect(outcome).toEqual([
      'seed-calls refuses to run: it only writes to a disposable database on this machine.',
      'seed-calls refuses to run: it only writes to a disposable database on this machine.',
      'ran',
    ]);
  });
});
