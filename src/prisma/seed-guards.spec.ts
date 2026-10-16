import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
  Each seed checks its database target before it builds a client (ADR-0095), and the policy is
  fixed per seed: reference data and the baseline may name one remote database on purpose, the
  fixtures never can. The scripts run on import, so this reads their source rather than running
  them; a new seed fails the last case until it is given a policy here.
*/
const SEEDS: [file: string, overridable: boolean][] = [
  ['seed.ts', true],
  ['seed-integrations.ts', true],
  ['seed-users-access.ts', true],
  ['seed-ui-reference.ts', false],
  ['seed-team-members.ts', false],
  ['seed-documents.ts', false],
  ['seed-dev-dataset.ts', false],
];

describe('seed database guards', () => {
  it.each(SEEDS)(
    '%s checks its target before it connects (overridable: %s)',
    (file, overridable) => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      const guard = source.indexOf('assertSeedTarget(');
      const client = source.indexOf('new PrismaClient(');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(client);
      expect(source.slice(guard, client)).toContain(
        `overridable: ${overridable}`,
      );
    },
  );

  it('seed-calls.mjs checks its target before it connects, with no override', () => {
    const source = readFileSync(
      join(__dirname, '../../prisma/seed-calls.mjs'),
      'utf8',
    );
    const guard = source.indexOf('assertLocalDatabase(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf('new pg.Client('));
    expect(source).not.toContain('SEED_ALLOW_REMOTE_DATABASE');
  });

  it('gives every seed script in this folder a policy', () => {
    const seeds = readdirSync(__dirname).filter(
      (file) => /^seed.*\.ts$/.test(file) && !file.endsWith('.spec.ts'),
    );
    expect(seeds.sort()).toEqual(SEEDS.map(([file]) => file).sort());
  });
});
