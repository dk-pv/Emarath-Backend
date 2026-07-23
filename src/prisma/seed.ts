/**
 * Prisma seed script.
 *
 * Seeds the agent accounts LEAD-01.1 AC4 assigns leads to. This is the minimum
 * slice of AUTH-01.1 that LEAD-01.1 needs — credentials, hashing and login are
 * AUTH-01.1/AUTH-01.2's own scope and are deliberately absent.
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
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../generated/prisma/client';

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
 * One account per role, so role scoping (LEAD-02.1 AC3) has something to scope
 * against the moment it lands. Names are placeholders for real staff records.
 */
const USERS: ReadonlyArray<{
  name: string;
  email: string;
  role: UserRole;
  team: string | null;
}> = [
  {
    name: 'Emarath Admin',
    email: 'admin@emarath.local',
    role: UserRole.SUPERADMIN,
    team: null,
  },
  {
    name: 'Sales Manager',
    email: 'manager@emarath.local',
    role: UserRole.SALES_MANAGER,
    team: 'Sales',
  },
  {
    name: 'Sales Agent One',
    email: 'agent1@emarath.local',
    role: UserRole.SALES_AGENT,
    team: 'Sales',
  },
  {
    name: 'Sales Agent Two',
    email: 'agent2@emarath.local',
    role: UserRole.SALES_AGENT,
    team: 'Sales',
  },
  {
    name: 'Customer Service Agent',
    email: 'service@emarath.local',
    role: UserRole.CUSTOMER_SERVICE_AGENT,
    team: 'Support',
  },
  {
    name: 'Marketing Analyst',
    email: 'marketing@emarath.local',
    role: UserRole.MARKETING_ANALYST,
    team: 'Marketing',
  },
];

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) {
    throw new Error('DATABASE_URL_UNPOOLED is not set.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    for (const user of USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        // Role and team are corrected on re-run; the account itself is left alone.
        update: { name: user.name, role: user.role, team: user.team },
        create: user,
      });
    }
    console.log(`[seed] ${USERS.length} users upserted.`);

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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
