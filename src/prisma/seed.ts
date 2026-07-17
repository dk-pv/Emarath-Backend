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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
