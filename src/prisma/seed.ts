/**
 * Prisma seed script (development only).
 *
 * Seeds one login per backlog role plus the default stage catalogue, so the app is
 * usable end-to-end in development: real credentials, bcrypt-hashed exactly as the
 * app hashes them (AUTH-01.1 AC4), ready for login (AUTH-01.2). Guarded against
 * NODE_ENV=production; real users are created through the app, never here.
 *
 * Idempotent: upserts by email, so re-running never duplicates an account and
 * never deletes one. Safe to run against a database that already holds leads.
 *
 * Lives under src/ rather than prisma/ because the Prisma 7 client is emitted as
 * TypeScript whose internals import with .js extensions: it only resolves once
 * compiled, so the seed has to be built alongside the app rather than run
 * straight off ts-node. `npm run db:seed` builds first for that reason.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../generated/prisma/client';
import { SOURCE } from '../lookups/lookups.data';

/**
 * The initial stage catalogue for the default board (KAN-05.1). Transcribed from
 * the Workpex stage set and order (`lead-status.mp4`), with a palette-key colour per
 * stage (the frontend maps the key to its design tokens). This is the seed that
 * makes the board, list badges and status dropdown all read one canonical source;
 * after this, add/rename/recolour/reorder/delete happen through the Stage API.
 */
const DEFAULT_PIPELINE = 'Lead Pipeline';

const STAGES: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'New', color: 'violet' },
  { name: 'Initial Contact', color: 'cyan' },
  { name: 'SUPER HOT', color: 'slate' },
  { name: 'HOT', color: 'amber' },
  { name: 'Cold', color: 'sky' },
  { name: 'Warm', color: 'yellow' },
  { name: 'DATE SHIPMENT', color: 'purple' },
  { name: 'NOT ANSWER', color: 'teal' },
  { name: 'NOT REACHEBLE', color: 'rose' },
  { name: 'Follow-Up', color: 'blue' },
  { name: 'Cancel', color: 'red' },
  { name: 'CS NUMBER Received', color: 'violet' },
  { name: 'SALES REJECTED', color: 'red' },
  { name: 'COMPLAINT', color: 'gray' },
  { name: 'QC NOT APPROVED', color: 'violet' },
  { name: 'WON', color: 'lime' },
  { name: 'READY TO DISPATCH', color: 'sky' },
  { name: 'Converted', color: 'lime' },
  { name: 'LOST', color: 'rose' },
];

/**
 * The Add Lead "Tags" options (LEAD-12.1). Tags are database-backed — the dropdown reads the
 * `Tag` table live — so the reference set is seeded here rather than in config. Verified against
 * the live Workpex Tags list; the dropdown sorts by name, which matches this (alphabetical) order.
 */
/**
 * The enquiry Category catalogue (Settings → Sales & CRM Configuration → Category).
 *
 * These two are the set the Workpex reference screen shows, and the pair that previously
 * lived in `lookups.data.ts` before the catalogue became a table. Seeded here for the same
 * reason tags are: the dropdown and the settings screen both read the table live.
 */
const CATEGORIES: readonly string[] = ['Default', 'Logistics'];

/**
 * The sales pipelines (Settings → Sales & CRM Configuration → Sales Pipeline).
 *
 * These four are the set the reference screen shows, and the set that previously lived in
 * `lookups.data.ts` before the catalogue became a table — `Lead.pipeline` rows already
 * carry these names. `Lead Pipeline` is the default, as the reference badge shows. No
 * short codes: the reference list has no such column, and inventing one would be inventing
 * data (the create form requires one for every pipeline made from here on).
 */
const PIPELINES: readonly string[] = [
  'Lead Pipeline',
  'Complaints',
  'LOGISTICS',
  'QC',
];

const TAGS: readonly string[] = [
  'BDE RISK',
  'BDM APPROVED',
  'CALL 1',
  'CALL 2',
  'CALL 3',
  'CALL 4',
  'DISPATCHED',
  'DUPLICATE',
  'NOT APPROVED',
  'QC 2 VERIFIED',
  'QC VERIFIED',
];

/**
 * One development login per role, so role scoping (LEAD-02.1 AC3) has something to
 * scope against and every backlog role is reachable from the login screen (AUTH-01.1
 * AC2). Names are placeholders for real staff records.
 *
 * The passwords here are **development seed defaults**, not application secrets: they
 * exist only in this seed (dev tooling), never in the running app, and the app stores
 * them solely as bcrypt hashes (AUTH-01.1 AC4). Any single value can be overridden for
 * a shared/CI database via SEED_USER_PASSWORD (applies to every account). The seed
 * refuses to run when NODE_ENV=production (see `main`).
 */
const USERS: ReadonlyArray<{
  name: string;
  email: string;
  username: string;
  role: UserRole;
  team: string | null;
  password: string;
}> = [
  {
    name: 'Emarath Admin',
    email: 'admin@emarath.com',
    username: 'admin',
    role: UserRole.SUPERADMIN,
    team: null,
    password: 'Admin@123',
  },
  {
    name: 'Sales Manager',
    email: 'manager@emarath.com',
    username: 'manager',
    role: UserRole.SALES_MANAGER,
    team: 'Sales',
    password: 'Manager@123',
  },
  {
    name: 'Sales Agent One',
    email: 'agent1@emarath.com',
    username: 'agent1',
    role: UserRole.SALES_AGENT,
    team: 'Sales',
    password: 'Agent@123',
  },
  {
    name: 'Sales Agent Two',
    email: 'agent2@emarath.com',
    username: 'agent2',
    role: UserRole.SALES_AGENT,
    team: 'Sales',
    password: 'Agent@123',
  },
  {
    name: 'Customer Service Agent',
    email: 'cs@emarath.com',
    username: 'cs',
    role: UserRole.CUSTOMER_SERVICE_AGENT,
    team: 'Support',
    password: 'Cs@123',
  },
  {
    name: 'Marketing Analyst',
    email: 'marketing@emarath.com',
    username: 'marketing',
    role: UserRole.MARKETING_ANALYST,
    team: 'Marketing',
    password: 'Marketing@123',
  },
];

/** bcrypt work factor — must match the app (auth.service.ts BCRYPT_ROUNDS) so seeded
 * hashes are indistinguishable from production ones. */
const BCRYPT_ROUNDS = 10;

async function main(): Promise<void> {
  // Development-only: real users are created through the app, never this seed.
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The seed is development-only and must not run in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) {
    throw new Error('DATABASE_URL_UNPOOLED is not set.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  // Collected for the post-seed credential printout below.
  const credentials: Array<{
    role: UserRole;
    email: string;
    password: string;
  }> = [];

  try {
    for (const { password, ...profile } of USERS) {
      // A shared override wins for every account (CI/shared DB); otherwise each uses
      // its documented dev default. Hashed exactly as the app hashes a password.
      const plainPassword = process.env['SEED_USER_PASSWORD'] ?? password;
      const passwordHash = bcrypt.hashSync(plainPassword, BCRYPT_ROUNDS);
      // Upsert by username → idempotent: username is the stable identity, so re-running
      // (or re-homing an account's email, e.g. an earlier @emarath.local seed) never
      // duplicates or deletes a row. Email, role, team and credentials are corrected on
      // every run (also replaces the migration's fail-closed sentinel hash).
      await prisma.user.upsert({
        where: { username: profile.username },
        update: {
          name: profile.name,
          email: profile.email,
          role: profile.role,
          team: profile.team,
          passwordHash,
        },
        create: { ...profile, passwordHash },
      });
      credentials.push({
        role: profile.role,
        email: profile.email,
        password: plainPassword,
      });
    }
    console.log(`[seed] ${USERS.length} users upserted.`);
    console.log('\n[seed] Development login credentials:');
    console.table(credentials);

    // Upsert by (pipeline, name): re-running corrects colour/order without ever
    // duplicating a stage or resetting one a user has since renamed away.
    for (const [position, stage] of STAGES.entries()) {
      await prisma.stage.upsert({
        where: {
          pipeline_name: { pipeline: DEFAULT_PIPELINE, name: stage.name },
        },
        update: { color: stage.color, position },
        create: {
          pipeline: DEFAULT_PIPELINE,
          name: stage.name,
          color: stage.color,
          position,
        },
      });
    }
    console.log(`[seed] ${STAGES.length} stages upserted.`);

    // Upsert by unique name → idempotent: re-running never duplicates a tag or deletes one a
    // lead already references (LeadTag FKs stay intact).
    for (const name of TAGS) {
      await prisma.tag.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }
    console.log(`[seed] ${TAGS.length} tags upserted.`);

    // Upsert by unique name → idempotent: re-running never duplicates a category, and it
    // never resets the status, order or parent a user has since changed.
    for (const [position, name] of CATEGORIES.entries()) {
      await prisma.category.upsert({
        where: { name },
        update: {},
        create: { name, position },
      });
    }
    console.log(`[seed] ${CATEGORIES.length} categories upserted.`);

    // Upsert by unique name → idempotent: re-running never duplicates a pipeline, and it
    // never resets a short code or a default a user has since changed.
    for (const name of PIPELINES) {
      await prisma.pipeline.upsert({
        where: { name },
        update: {},
        create: { name, isDefault: name === DEFAULT_PIPELINE },
      });
    }
    console.log(`[seed] ${PIPELINES.length} pipelines upserted.`);

    // The lead source catalogue. Upsert by unique name → idempotent, and `update: {}` so
    // re-running never reactivates a source a user has deactivated. The catalogue's own
    // migration additionally back-fills any source value existing leads already carry, so
    // no lead can sit on a source the catalogue does not list.
    for (const name of SOURCE) {
      await prisma.leadSource.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }
    console.log(`[seed] ${SOURCE.length} lead sources upserted.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
