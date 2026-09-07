/**
 * Users & Access reference data (ADR-0055): the five built-in roles and the one
 * built-in lead form the "Create A Team Member" wizard needs on a fresh database.
 *
 * Idempotent upserts by unique `name`; the update branch refreshes `baseRole` and
 * clears `deletedAt` (re-seeding is the way to restore a retired built-in) but never
 * touches rows this seed did not define — custom roles created later are untouched.
 *
 * Production-guarded like every other seed here: loading reference data in a real
 * environment is a deliberate human action, not something a script decides.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../generated/prisma/client';
import { LEAD_SYSTEM_FIELDS } from '../lead-forms/lead-system-fields';

/**
 * The built-in role names, one per seeded UserRole (AUTH-01.1's five user types).
 * Custom roles ("QC ROLE", "LOGISTICS MANAGER") are created through the Roles &
 * Permissions screen when it lands — none is invented here.
 */
const ROLES: { name: string; baseRole: UserRole }[] = [
  { name: 'Account Holder', baseRole: UserRole.SUPERADMIN },
  { name: 'Sales Manager', baseRole: UserRole.SALES_MANAGER },
  { name: 'Sales Agent', baseRole: UserRole.SALES_AGENT },
  { name: 'Customer Service', baseRole: UserRole.CUSTOMER_SERVICE_AGENT },
  { name: 'Marketing Analyst', baseRole: UserRole.MARKETING_ANALYST },
];

/** The one lead form the reference shows as a built-in option. */
const LEAD_FORMS = ['Custom Lead Form'];

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The users-access seed must not run unattended in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is not set.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    for (const role of ROLES) {
      await prisma.role.upsert({
        where: { name: role.name },
        create: role,
        update: { baseRole: role.baseRole, deletedAt: null },
      });
    }

    for (const name of LEAD_FORMS) {
      await prisma.leadForm.upsert({
        where: { name },
        create: {
          name,
          module: 'LEAD',
          isActive: true,
          isDefault: true,
          createdByName: 'ADMIN',
        },
        update: {
          deletedAt: null,
          isActive: true,
          isDefault: true,
          createdByName: 'ADMIN',
        },
      });
    }

    /*
     * The built-in form's field list (ADR-0072): every Lead field, visible, in the order
     * the shipped drawer renders them. Seeded rather than left empty so the default form
     * *is* the form the application already shows — configuring it starts from parity,
     * not from a blank slate. Re-running replaces the list, so an edited form is restored
     * to the built-in arrangement, which is what re-seeding a built-in means here.
     */
    const builtIn = await prisma.leadForm.findUnique({
      where: { name: LEAD_FORMS[0] },
      select: { id: true },
    });
    if (builtIn) {
      await prisma.leadFormField.deleteMany({ where: { formId: builtIn.id } });
      await prisma.leadFormField.createMany({
        data: LEAD_SYSTEM_FIELDS.map((field, index) => ({
          formId: builtIn.id,
          fieldKey: field.key,
          position: index + 1,
          isVisible: true,
        })),
      });
    }

    const roles = await prisma.role.count({ where: { deletedAt: null } });
    const forms = await prisma.leadForm.count({ where: { deletedAt: null } });
    console.log(
      `[users-access] ${ROLES.length} built-in role(s) and ` +
        `${LEAD_FORMS.length} lead form(s) upserted; ${roles} role(s), ` +
        `${forms} form(s) now live.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
