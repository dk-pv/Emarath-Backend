/**
 * Sample team members — development fixture (Settings → Users & Access).
 *
 * Ten realistic members so the roster's search, role filter, pagination, statuses,
 * reporting lines, pipelines, permissions and activity columns all have something real
 * to exercise. ADR-0053 pattern: separate, idempotent, production-guarded.
 *
 * Idempotent and self-owned: each member is upserted by their unique
 * `sample.*@emarath.dev` email, and a re-run resets that member to the fixture's
 * definition (including their permission rows). The fixture owns ONLY these ten
 * addresses — accounts created by hand are never touched.
 *
 * The `sample.` prefix is what separates permanent sample data from throwaway QA
 * accounts (`ui.flow.*`, `wiz.*`, …), which browser tests create and delete themselves.
 *
 * `lastSeenAt`/`lastLoginAt` are synthetic, relative to the run (the documents fixture's
 * `hoursAgo` precedent) so the two activity columns render real formats; two members are
 * deliberately left as never-signed-in. Passwords are bcrypt-hashed at the app's work
 * factor; the plaintext defaults to a development value overridable via
 * SEED_USER_PASSWORD and is never printed.
 *
 * Prerequisites: `seed:users-access` (roles + lead form) and `seed:run` (baseline).
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { PERMISSION_CATALOG } from '../users/permission-catalog';

const BCRYPT_ROUNDS = 10;
const HOUR_MS = 60 * 60 * 1000;

/** Desired flags per module; intersected with the catalogue so no row can violate it. */
type PermissionTemplate = Record<
  string,
  { view?: boolean; add?: boolean; edit?: boolean }
>;

const SALES_PERMISSIONS: PermissionTemplate = {
  DASHBOARD: { view: true },
  LEADS: { view: true, add: true, edit: true },
  ACTIVITIES: { view: true, add: true, edit: true },
  CALLS: { view: true, add: true },
  GPS_MAP: { view: true },
  REPORTS: { view: true },
};

const MANAGER_PERMISSIONS: PermissionTemplate = {
  ...SALES_PERMISSIONS,
  PIPELINE: { view: true, add: true, edit: true },
  EXPORT: { view: true },
  CHANGE_OWNERSHIP: { add: true, edit: true },
};

const SUPPORT_PERMISSIONS: PermissionTemplate = {
  DASHBOARD: { view: true },
  LEADS: { view: true },
  ACTIVITIES: { view: true, add: true },
  CALLS: { view: true, add: true },
  NOTIFICATIONS: { view: true },
};

const ANALYST_PERMISSIONS: PermissionTemplate = {
  DASHBOARD: { view: true },
  LEADS: { view: true },
  REPORTS: { view: true },
  EXPORT: { view: true },
};

interface SampleMember {
  firstName: string;
  lastName: string;
  email: string;
  roleName: string;
  jobTitle: string;
  team: string;
  phoneSuffix: string;
  pipelines: string[];
  leadForm: boolean;
  isActive: boolean;
  reportsToAhmed: boolean;
  appAccess: boolean;
  trackCheckInOut: boolean;
  trackMeetingLocation: boolean;
  includeInReporting: boolean;
  autoFollowUpPrompt: boolean;
  whatsappInboxAccess: 'RESTRICTED' | 'FULL' | null;
  colorCode: string | null;
  monthlyGoalAmount: number | null;
  /** Hours since last activity; null = has never signed in. */
  lastSeenHoursAgo: number | null;
  permissions: PermissionTemplate;
}

const MEMBERS: SampleMember[] = [
  {
    firstName: 'Ahmed',
    lastName: 'Rahman',
    email: 'sample.ahmed.rahman@emarath.dev',
    roleName: 'Sales Manager',
    jobTitle: 'Sales Manager',
    team: 'Sales',
    phoneSuffix: '01',
    pipelines: ['Lead Pipeline', 'Complaints'],
    leadForm: true,
    isActive: true,
    reportsToAhmed: false,
    appAccess: true,
    trackCheckInOut: true,
    trackMeetingLocation: true,
    includeInReporting: true,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: 'FULL',
    colorCode: '#2563eb',
    monthlyGoalAmount: 150000,
    lastSeenHoursAgo: 2,
    permissions: MANAGER_PERMISSIONS,
  },
  {
    firstName: 'Sarah',
    lastName: 'Thomas',
    email: 'sample.sarah.thomas@emarath.dev',
    roleName: 'Sales Agent',
    jobTitle: 'BDE',
    team: 'Sales',
    phoneSuffix: '02',
    pipelines: ['Lead Pipeline'],
    leadForm: true,
    isActive: true,
    reportsToAhmed: true,
    appAccess: true,
    trackCheckInOut: true,
    trackMeetingLocation: false,
    includeInReporting: true,
    autoFollowUpPrompt: true,
    whatsappInboxAccess: 'RESTRICTED',
    colorCode: '#16a34a',
    monthlyGoalAmount: 50000,
    lastSeenHoursAgo: 5,
    permissions: SALES_PERMISSIONS,
  },
  {
    firstName: 'Arjun',
    lastName: 'Kumar',
    email: 'sample.arjun.kumar@emarath.dev',
    roleName: 'Sales Agent',
    jobTitle: 'BDE',
    team: 'Sales',
    phoneSuffix: '03',
    pipelines: ['Lead Pipeline', 'QC'],
    leadForm: true,
    isActive: true,
    reportsToAhmed: true,
    appAccess: true,
    trackCheckInOut: true,
    trackMeetingLocation: true,
    includeInReporting: true,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: 'RESTRICTED',
    colorCode: null,
    monthlyGoalAmount: 50000,
    lastSeenHoursAgo: 26,
    permissions: SALES_PERMISSIONS,
  },
  {
    firstName: 'Neha',
    lastName: 'Sharma',
    email: 'sample.neha.sharma@emarath.dev',
    roleName: 'Customer Service',
    jobTitle: 'Support Executive',
    team: 'Support',
    phoneSuffix: '04',
    pipelines: ['Complaints'],
    leadForm: true,
    isActive: true,
    reportsToAhmed: true,
    appAccess: false,
    trackCheckInOut: false,
    trackMeetingLocation: false,
    includeInReporting: true,
    autoFollowUpPrompt: true,
    whatsappInboxAccess: 'RESTRICTED',
    colorCode: '#db2777',
    monthlyGoalAmount: null,
    lastSeenHoursAgo: 8,
    permissions: SUPPORT_PERMISSIONS,
  },
  {
    firstName: 'Mohammed',
    lastName: 'Faisal',
    email: 'sample.mohammed.faisal@emarath.dev',
    roleName: 'Customer Service',
    jobTitle: 'Support Executive',
    team: 'Support',
    phoneSuffix: '05',
    pipelines: ['Complaints'],
    leadForm: true,
    isActive: false,
    reportsToAhmed: true,
    appAccess: false,
    trackCheckInOut: false,
    trackMeetingLocation: false,
    includeInReporting: false,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: null,
    colorCode: null,
    monthlyGoalAmount: null,
    lastSeenHoursAgo: null,
    permissions: SUPPORT_PERMISSIONS,
  },
  {
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'sample.priya.nair@emarath.dev',
    roleName: 'Marketing Analyst',
    jobTitle: 'Marketing Analyst',
    team: 'Marketing',
    phoneSuffix: '06',
    pipelines: ['Lead Pipeline'],
    leadForm: false,
    isActive: true,
    reportsToAhmed: false,
    appAccess: false,
    trackCheckInOut: false,
    trackMeetingLocation: false,
    includeInReporting: true,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: null,
    colorCode: '#9333ea',
    monthlyGoalAmount: null,
    lastSeenHoursAgo: 50,
    permissions: ANALYST_PERMISSIONS,
  },
  {
    firstName: 'Daniel',
    lastName: 'Joseph',
    email: 'sample.daniel.joseph@emarath.dev',
    roleName: 'Sales Agent',
    jobTitle: 'BDE',
    team: 'Sales',
    phoneSuffix: '07',
    pipelines: ['Lead Pipeline'],
    leadForm: true,
    isActive: true,
    reportsToAhmed: true,
    appAccess: true,
    trackCheckInOut: false,
    trackMeetingLocation: false,
    includeInReporting: true,
    autoFollowUpPrompt: true,
    whatsappInboxAccess: 'RESTRICTED',
    colorCode: null,
    monthlyGoalAmount: 45000,
    lastSeenHoursAgo: 74,
    permissions: SALES_PERMISSIONS,
  },
  {
    firstName: 'Aisha',
    lastName: 'Khan',
    email: 'sample.aisha.khan@emarath.dev',
    roleName: 'Customer Service',
    jobTitle: 'Support Executive',
    team: 'Support',
    phoneSuffix: '08',
    pipelines: ['Complaints', 'QC'],
    leadForm: true,
    isActive: true,
    reportsToAhmed: true,
    appAccess: false,
    trackCheckInOut: false,
    trackMeetingLocation: false,
    includeInReporting: true,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: 'RESTRICTED',
    colorCode: null,
    monthlyGoalAmount: null,
    lastSeenHoursAgo: 30,
    permissions: SUPPORT_PERMISSIONS,
  },
  {
    firstName: 'Rahul',
    lastName: 'Menon',
    email: 'sample.rahul.menon@emarath.dev',
    roleName: 'Sales Agent',
    jobTitle: 'BDE',
    team: 'Sales',
    phoneSuffix: '09',
    pipelines: ['Lead Pipeline'],
    leadForm: true,
    isActive: false,
    reportsToAhmed: true,
    appAccess: false,
    trackCheckInOut: false,
    trackMeetingLocation: false,
    includeInReporting: false,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: null,
    colorCode: null,
    monthlyGoalAmount: 45000,
    lastSeenHoursAgo: 200,
    permissions: SALES_PERMISSIONS,
  },
  {
    firstName: 'Maria',
    lastName: 'George',
    email: 'sample.maria.george@emarath.dev',
    roleName: 'Marketing Analyst',
    jobTitle: 'Marketing Analyst',
    team: 'Marketing',
    phoneSuffix: '10',
    pipelines: [],
    leadForm: false,
    isActive: true,
    reportsToAhmed: false,
    appAccess: false,
    trackCheckInOut: false,
    trackMeetingLocation: false,
    includeInReporting: true,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: null,
    colorCode: null,
    monthlyGoalAmount: null,
    lastSeenHoursAgo: null,
    permissions: ANALYST_PERMISSIONS,
  },
];

/** Intersects a template with the catalogue, so an inapplicable flag can never persist. */
function permissionRows(
  userId: string,
  template: PermissionTemplate,
): {
  userId: string;
  module: string;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
}[] {
  return Object.entries(template)
    .map(([module, wanted]) => {
      const rule = PERMISSION_CATALOG.find((row) => row.module === module);
      if (!rule) throw new Error(`Unknown permission module "${module}".`);
      return {
        userId,
        module,
        canView: Boolean(wanted.view && rule.view),
        canAdd: Boolean(wanted.add && rule.add),
        canEdit: Boolean(wanted.edit && rule.edit),
      };
    })
    .filter((row) => row.canView || row.canAdd || row.canEdit);
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The team-members fixture is development-only and must not run in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is not set.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const roles = await prisma.role.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, baseRole: true },
    });
    if (roles.length === 0) {
      throw new Error(
        'No roles found — run `npm run seed:users-access` first.',
      );
    }
    const leadForm = await prisma.leadForm.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!leadForm) {
      throw new Error(
        'No lead form found — run `npm run seed:users-access` first.',
      );
    }

    const passwordHash = await bcrypt.hash(
      process.env['SEED_USER_PASSWORD'] ?? 'Sample@123',
      BCRYPT_ROUNDS,
    );
    const now = Date.now();
    let ahmedId: string | null = null;

    for (const member of MEMBERS) {
      const role = roles.find((row) => row.name === member.roleName);
      if (!role) {
        throw new Error(`Role "${member.roleName}" is not seeded.`);
      }

      const lastSeenAt =
        member.lastSeenHoursAgo === null
          ? null
          : new Date(now - member.lastSeenHoursAgo * HOUR_MS);
      const lastLoginAt =
        lastSeenAt === null
          ? null
          : new Date(lastSeenAt.getTime() - 6 * HOUR_MS);

      const data = {
        name: `${member.firstName} ${member.lastName}`,
        firstName: member.firstName,
        lastName: member.lastName,
        username: `sample-${member.firstName.toLowerCase()}-${member.lastName.toLowerCase()}`,
        role: role.baseRole,
        roleId: role.id,
        jobTitle: member.jobTitle,
        team: member.team,
        phone: `9715086500${member.phoneSuffix}`,
        isActive: member.isActive,
        reportingToId: member.reportsToAhmed ? ahmedId : null,
        leadFormId: member.leadForm ? leadForm.id : null,
        pipelines: member.pipelines,
        appAccess: member.appAccess,
        trackCheckInOut: member.trackCheckInOut,
        trackMeetingLocation: member.trackMeetingLocation,
        includeInReporting: member.includeInReporting,
        autoFollowUpPrompt: member.autoFollowUpPrompt,
        whatsappInboxAccess: member.whatsappInboxAccess,
        colorCode: member.colorCode,
        monthlyGoalAmount: member.monthlyGoalAmount,
        lastSeenAt,
        lastLoginAt,
        deletedAt: null,
      };

      // The fixture owns its ten members: a re-run resets them to this definition.
      // The password is only set on create, so SEED_USER_PASSWORD rotations require
      // the roster's own Change Password action — never a silent seed overwrite.
      //
      // The result annotation is load-bearing: `ahmedId` feeds `data`, `data` feeds
      // this upsert, and the result feeds `ahmedId` back — a cycle the lint compiler
      // breaks by widening everything to `any`. Naming the type breaks the cycle.
      const user: { id: string } = await prisma.user.upsert({
        where: { email: member.email },
        create: { email: member.email, passwordHash, ...data },
        update: data,
        select: { id: true },
      });

      if (member.email === 'sample.ahmed.rahman@emarath.dev') {
        ahmedId = user.id;
      }

      await prisma.userModulePermission.deleteMany({
        where: { userId: user.id },
      });
      const rows = permissionRows(user.id, member.permissions);
      if (rows.length > 0) {
        await prisma.userModulePermission.createMany({ data: rows });
      }
    }

    const live = await prisma.user.count({ where: { deletedAt: null } });
    console.log(
      `[team-members] ${MEMBERS.length} sample member(s) upserted; ` +
        `${live} live member(s) total. Sample password: SEED_USER_PASSWORD ` +
        `(see the script header for the development default).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
