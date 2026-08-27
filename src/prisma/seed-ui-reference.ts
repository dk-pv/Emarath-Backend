/**
 * UI-reference development fixture (KAN-07.2) — development only.
 *
 * The Workpex filter reference shows two saved-filter presets whose conditions read
 * "Assigned User Isn't Ansar UAE +3" and "Assigned User Is ADNAN S +12". Reproducing
 * those chip counts needs assignable agents this database does not have: the standard
 * seed provides five, and "+12" alone needs thirteen.
 *
 * This script adds only the users. It is deliberately NOT part of `src/prisma/seed.ts`:
 * that seed is the project's canonical baseline (one login per backlog role, stages,
 * tags) and must not grow a screenshot's worth of extra agents. Run this one only when
 * you need the filter panel to match the reference capture.
 *
 * The saved filters themselves are NOT created here — they are user-owned records and
 * are created through `POST /api/saved-filters` like any other, see
 * `project-docs/decisions/ADR-0053-ui-reference-fixture.md`.
 *
 * Honesty note: only `Ansar UAE` and `ADNAN S` are names taken from the Workpex
 * reference. The reference does not show the other agents' names — the capture collapses
 * them into "+3"/"+12" — so they are named `Reference Agent NN` rather than invented and
 * passed off as Workpex data.
 *
 * Idempotent: upserts by username, exactly as the main seed does, so re-running never
 * duplicates or deletes an account. Guarded against NODE_ENV=production.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../generated/prisma/client';

/** Matches the app and the main seed (auth.service.ts BCRYPT_ROUNDS). */
const BCRYPT_ROUNDS = 10;

/** The two names the reference actually shows, plus the fillers for "+3" and "+12". */
const REFERENCE_USERS: ReadonlyArray<{ name: string; username: string }> = [
  { name: 'Ansar UAE', username: 'ref-ansar-uae' },
  { name: 'ADNAN S', username: 'ref-adnan-s' },
  ...Array.from({ length: 12 }, (_, index) => {
    const nn = String(index + 1).padStart(2, '0');
    return { name: `Reference Agent ${nn}`, username: `ref-agent-${nn}` };
  }),
];

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The UI-reference fixture is development-only and must not run in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) {
    throw new Error('DATABASE_URL_UNPOOLED is not set.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  // One shared password for the whole fixture: these accounts exist to be assignment
  // targets in the filter's user list, not to be logged into.
  const plainPassword =
    process.env['SEED_USER_PASSWORD'] ?? 'ReferenceFixture@123';
  const passwordHash = bcrypt.hashSync(plainPassword, BCRYPT_ROUNDS);

  try {
    for (const profile of REFERENCE_USERS) {
      await prisma.user.upsert({
        where: { username: profile.username },
        update: {
          name: profile.name,
          // Assignable agents are SALES_AGENT / SALES_MANAGER / CUSTOMER_SERVICE_AGENT
          // (leads.service.ts assignableAgents), so the fixture uses the plainest of
          // the three. No team is set — this fixture introduces no team semantics.
          role: UserRole.SALES_AGENT,
        },
        create: {
          name: profile.name,
          username: profile.username,
          email: `${profile.username}@emarath.dev`,
          role: UserRole.SALES_AGENT,
          passwordHash,
        },
      });
    }
    console.log(
      `[ui-reference] ${REFERENCE_USERS.length} reference agents upserted.`,
    );
    console.log(
      '[ui-reference] Shared fixture password:',
      plainPassword,
      '(override with SEED_USER_PASSWORD)',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[ui-reference] failed:', error);
  process.exit(1);
});
