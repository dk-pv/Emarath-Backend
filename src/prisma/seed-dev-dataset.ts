/**
 * Development dataset fixture — development only.
 *
 * The canonical seed (`src/prisma/seed.ts`) creates logins, stages and tags and
 * nothing else, by design: it is the project baseline and must not grow a dataset.
 * ADR-0053 set the pattern for anything beyond it — a separate, idempotent,
 * production-guarded fixture script. This is that pattern applied to the problem the
 * data audit found: 262 leads of QA debris and three activities, all on one lead, so
 * every Activities tab was empty and no filter, pagination or role scope could be
 * exercised.
 *
 * It creates 280 leads and 420 activities wired through the real relationships —
 * `Activity.leadId → Lead`, `ActivityAssignee → Activity/User`, `LeadAssignment →
 * Lead/User`, `LeadTag → Lead/Tag`. No lead field is copied onto an activity: the
 * worklist reads Customer Name, Pipeline, Status, Phone and Tags through the join,
 * exactly as `ACTIVITY_LIST_SELECT` already does.
 *
 * Deterministic: a seeded PRNG plus ids derived from a fixed namespace, so a re-run
 * produces byte-identical rows and replaces only what it created — never a row a
 * human or another fixture made. Dates are relative to the run, so the Overdue /
 * Today / Tomorrow tabs stay meaningful next week instead of rotting to a fixed day.
 *
 * Users are NOT created: it assigns from the agents the seed and the UI-reference
 * fixture already provide.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { ActivityType, PrismaClient } from '../generated/prisma/client';
import { LOOKUP_DATA } from '../lookups/lookups.data';
import { DEFAULT_PIPELINE } from '../stages/stage.constants';

const LEAD_COUNT = 280;
/** 180 leads carry 1–5 activities; the remaining 100 deliberately carry none. */
const LEADS_WITH_ACTIVITIES = 180;

/** Per bucket, as the worklist tabs define them (`activity-buckets.ts`). */
const BUCKETS = {
  overdue: 95,
  today: 40,
  tomorrow: 30,
  /** Open and beyond tomorrow: visible in All only, in none of the four tabs. */
  future: 65,
  completed: 190,
} as const;

const ACTIVITY_COUNT = Object.values(BUCKETS).reduce((a, b) => a + b, 0);

/**
 * A fixed namespace, so every id this fixture writes is reproducible and the set it
 * owns is exactly knowable. Derived, never hard-coded: a re-run recomputes them and
 * replaces its own rows rather than duplicating them.
 */
const NAMESPACE = 'emarath.dev-dataset.v1';

function fixtureId(kind: string, index: number): string {
  const hex = createHash('sha1')
    .update(`${NAMESPACE}:${kind}:${index}`)
    .digest('hex');
  // Shape the digest as a v5 UUID so Postgres accepts it as `uuid`.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, '0') + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** mulberry32 — a tiny deterministic PRNG, so no faker dependency is introduced. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Abdul',
  'Ahmed',
  'Ali',
  'Anjali',
  'Ansar',
  'Arun',
  'Asma',
  'Bineesh',
  'Deepa',
  'Faisal',
  'Fatima',
  'Hamza',
  'Haris',
  'Ibrahim',
  'Jaseem',
  'Jithin',
  'Kavya',
  'Khalid',
  'Lubna',
  'Manoj',
  'Meera',
  'Mohammed',
  'Muhsin',
  'Nadeem',
  'Nasser',
  'Nithya',
  'Noora',
  'Omar',
  'Praveen',
  'Rahul',
  'Rashid',
  'Reema',
  'Rifa',
  'Sadiq',
  'Saeed',
  'Saidalavi',
  'Salma',
  'Sanjay',
  'Shabeer',
  'Shanoj',
  'Sneha',
  'Sujith',
  'Suresh',
  'Tariq',
  'Usman',
  'Vinod',
  'Yousef',
  'Zainab',
];

const LAST_NAMES = [
  'Abdulla',
  'Ahammed',
  'Akhtar',
  'Al Balushi',
  'Al Farsi',
  'Al Hashmi',
  'Al Mansoori',
  'Al Zaabi',
  'Anwar',
  'Chandran',
  'Faruqi',
  'Ghani',
  'Hassan',
  'Ibrahim',
  'Iqbal',
  'Kunhimohammed',
  'Kurian',
  'Menon',
  'Mustafa',
  'Nair',
  'Pillai',
  'Qureshi',
  'Rahman',
  'Raj',
  'Sadeeq',
  'Shereef',
  'Siddiqui',
  'Thayyil',
  'Varghese',
  'Yousuf',
];

const COUNTRIES = [
  { name: 'United Arab Emirates', dial: '971' },
  { name: 'Saudi Arabia', dial: '966' },
  { name: 'Qatar', dial: '974' },
  { name: 'Bahrain', dial: '973' },
  { name: 'Oman', dial: '968' },
];

const CITIES = [
  'Dubai',
  'Abu Dhabi',
  'Sharjah',
  'Ajman',
  'Riyadh',
  'Jeddah',
  'Doha',
  'Manama',
  'Muscat',
  'Al Ain',
];

const NOTES = [
  'Customer asked to call back after 6 PM.',
  'Shared the product catalogue on WhatsApp.',
  'Confirmed the delivery address, awaiting payment.',
  'Interested in the combo offer, needs pricing.',
  'Requested a sample before ordering.',
  'Follow up on the pending invoice.',
  'Wants delivery before the weekend.',
  'Line was busy, try the secondary number.',
  'Asked for an Arabic-speaking agent.',
  'Reorder discussion — same items as last time.',
  'Complaint raised about a delayed shipment.',
  'Quotation sent, awaiting confirmation.',
];

/** Values a lookup offers, as plain strings. */
const values = (options: readonly { value: string }[]) =>
  options.map((option) => option.value);

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The development dataset is development-only and must not run in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is not set.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    // ── Read the catalogues this dataset must stay inside ────────────────────
    const agents = await prisma.user.findMany({
      where: {
        role: {
          in: ['SALES_AGENT', 'SALES_MANAGER', 'CUSTOMER_SERVICE_AGENT'],
        },
      },
      select: { id: true, name: true },
      orderBy: { username: 'asc' },
    });
    if (agents.length === 0) {
      throw new Error(
        'No assignable agents found — run `npm run seed:run` first.',
      );
    }

    const stages = await prisma.stage.findMany({
      where: { pipeline: DEFAULT_PIPELINE },
      select: { name: true },
      orderBy: { position: 'asc' },
    });
    if (stages.length === 0) {
      throw new Error('No stages found — run `npm run seed:run` first.');
    }
    const statuses = stages.map((stage) => stage.name);

    const tags = await prisma.tag.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { name: 'asc' },
    });

    const sources = values(LOOKUP_DATA.sources);
    const languages = values(LOOKUP_DATA.languages);
    const callStatuses = values(LOOKUP_DATA.callStatus);
    const categories = values(LOOKUP_DATA.categories);
    const payments = values(LOOKUP_DATA.paymentMethods);
    const products = values(LOOKUP_DATA.products);

    console.log(
      `[dev-dataset] catalogues: ${agents.length} agents · ${statuses.length} stages · ` +
        `${tags.length} tags · ${sources.length} sources · ${products.length} products`,
    );

    // ── Ids this fixture owns ────────────────────────────────────────────────
    const leadIds = Array.from({ length: LEAD_COUNT }, (_, i) =>
      fixtureId('lead', i),
    );
    const activityIds = Array.from({ length: ACTIVITY_COUNT }, (_, i) =>
      fixtureId('activity', i),
    );

    // ── Replace only this fixture's own rows (idempotent re-run) ─────────────
    const previous = await prisma.lead.count({
      where: { id: { in: leadIds } },
    });
    if (previous > 0) {
      // Cascades remove their activities, assignments and tag links.
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
      console.log(
        `[dev-dataset] removed ${previous} rows from a previous run.`,
      );
    }

    // ── Soft-delete the pre-existing QA leads (reversible) ───────────────────
    const stale = await prisma.lead.findMany({
      where: { deletedAt: null, id: { notIn: leadIds } },
      select: { id: true, name: true },
    });
    if (stale.length > 0) {
      // Safety valve: this fixture is meant to retire a few hundred QA rows. A far
      // larger set means it is pointed at a database it should not be touching.
      if (stale.length > 1000) {
        throw new Error(
          `Refusing to soft-delete ${stale.length} leads — that is far more than the ` +
            'QA debris this fixture is meant to retire. Check the DATABASE_URL.',
        );
      }
      console.log(
        `[dev-dataset] soft-deleting ${stale.length} pre-existing leads, e.g. ` +
          stale
            .slice(0, 3)
            .map((lead) => `"${lead.name}"`)
            .join(', '),
      );
      const staleIds = stale.map((lead) => lead.id);
      const now = new Date();
      await prisma.lead.updateMany({
        where: { id: { in: staleIds } },
        data: { deletedAt: now },
      });
      // The activities list scopes on the activity's own deletedAt, not the lead's,
      // so a retired lead's follow-ups would otherwise still surface on the worklist.
      // Soft-deleting them alongside keeps the two consistent without changing the
      // query contract.
      const orphaned = await prisma.activity.updateMany({
        where: { leadId: { in: staleIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      console.log(
        `[dev-dataset] soft-deleted ${orphaned.count} activities belonging to them.`,
      );
    }

    // ── Leads ────────────────────────────────────────────────────────────────
    const random = rng(20260828);
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(random() * list.length)];
    const chance = (p: number) => random() < p;
    const between = (min: number, max: number) =>
      min + Math.floor(random() * (max - min + 1));

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dayMs = 86_400_000;

    const leads = leadIds.map((id, index) => {
      const country = pick(COUNTRIES);
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const phone = `${country.dial}${between(50, 59)}${between(1000000, 9999999)}`;
      // Every lead stays in the default pipeline: it is the ONLY pipeline with a
      // stage catalogue, so a lead in LOGISTICS/Complaints/QC would hold a status
      // its own board does not offer and `stages.exists` would reject a board move.
      // Varying this needs stages seeded for those pipelines, which is KAN-05.1's
      // catalogue to own, not a fixture's.
      const pipeline = DEFAULT_PIPELINE;
      return {
        id,
        name: chance(0.12) ? phone : `${first} ${last}`,
        firstName: first,
        primaryPhone: phone,
        secondaryPhone: chance(0.35)
          ? `${country.dial}${between(50, 59)}${between(1000000, 9999999)}`
          : null,
        email: chance(0.45)
          ? `${first}.${last}${index}`
              .toLowerCase()
              .replace(/[^a-z0-9.]/g, '') + '@example.com'
          : null,
        language: pick(languages),
        country: country.name,
        city: pick(CITIES),
        source: chance(0.96) ? pick(sources) : null,
        status: pick(statuses),
        pipeline,
        product: chance(0.7) ? pick(products) : null,
        productQty: chance(0.7) ? String(between(1, 4)) : null,
        category: chance(0.8) ? pick(categories) : null,
        paymentMethod: chance(0.6) ? pick(payments) : null,
        callStatus: chance(0.9) ? pick(callStatuses) : null,
        callAttempts: between(0, 4),
        whatsappAttempts: between(0, 4),
        actualAmount: chance(0.4) ? String(between(120, 4800)) : null,
        forecastedAmount: chance(0.5) ? String(between(150, 6000)) : null,
        // Spread over ~120 days so date-range filters have something to bite on.
        createdAt: new Date(
          startOfToday.getTime() -
            between(0, 120) * dayMs -
            between(0, 86_399) * 1000,
        ),
      };
    });

    await prisma.lead.createMany({ data: leads });
    console.log(`[dev-dataset] ${leads.length} leads created.`);

    // ── Lead assignments: every lead to 1–2 agents, spread across all of them ──
    const leadAssignments = leads.flatMap((lead, index) => {
      const count = chance(0.3) ? 2 : 1;
      const chosen = new Set<string>();
      // Round-robin the primary owner so no single agent holds the whole dataset,
      // then add a random second so the assignee filter has overlaps to match.
      chosen.add(agents[index % agents.length].id);
      while (chosen.size < count) chosen.add(pick(agents).id);
      return [...chosen].map((userId) => ({
        id: randomUUID(),
        leadId: lead.id,
        userId,
      }));
    });
    await prisma.leadAssignment.createMany({ data: leadAssignments });
    console.log(
      `[dev-dataset] ${leadAssignments.length} lead assignments created.`,
    );

    // ── Lead tags ────────────────────────────────────────────────────────────
    if (tags.length > 0) {
      const leadTags = leads.flatMap((lead) => {
        const count = chance(0.68) ? between(1, 3) : 0;
        const chosen = new Set<string>();
        while (chosen.size < count) chosen.add(pick(tags).id);
        return [...chosen].map((tagId) => ({
          id: randomUUID(),
          leadId: lead.id,
          tagId,
        }));
      });
      await prisma.leadTag.createMany({ data: leadTags });
      console.log(`[dev-dataset] ${leadTags.length} lead tags created.`);
    }

    // ── Activities ───────────────────────────────────────────────────────────
    // The leads that carry follow-ups; the rest are deliberately left bare so the
    // "lead with no activity" case is represented.
    const carriers = leads.slice(0, LEADS_WITH_ACTIVITIES);

    /** A due instant inside the window a bucket's predicate selects. */
    const dueFor = (bucket: keyof typeof BUCKETS): Date => {
      const hour = between(8, 17);
      const minute = pick([0, 15, 30, 45]);
      const at = new Date(startOfToday);
      switch (bucket) {
        case 'overdue':
          at.setDate(at.getDate() - between(1, 45));
          break;
        case 'today':
          break;
        case 'tomorrow':
          at.setDate(at.getDate() + 1);
          break;
        case 'future':
          at.setDate(at.getDate() + between(2, 30));
          break;
        case 'completed':
          at.setDate(at.getDate() - between(1, 90));
          break;
      }
      at.setHours(hour, minute, 0, 0);
      return at;
    };

    const plan: (keyof typeof BUCKETS)[] = Object.entries(BUCKETS).flatMap(
      ([bucket, count]) =>
        Array.from({ length: count }, () => bucket as keyof typeof BUCKETS),
    );

    const activities = plan.map((bucket, index) => {
      const type = pick<ActivityType>([
        ActivityType.CALL,
        ActivityType.CALL,
        ActivityType.CALL,
        ActivityType.CALL,
        ActivityType.CALL,
        ActivityType.CALL,
        ActivityType.TASK,
        ActivityType.TASK,
        ActivityType.TASK,
        ActivityType.MEETING,
        ActivityType.MEETING,
      ]);
      const dueAt = dueFor(bucket);
      // Only a Meeting or a Task carries an End Time — the service's
      // `assertTypeShape` rejects one on a Call.
      const endAt =
        type === ActivityType.CALL || !chance(0.6)
          ? null
          : new Date(dueAt.getTime() + between(1, 4) * 30 * 60_000);
      return {
        id: activityIds[index],
        type,
        // Spread across the carrier leads, so most hold several follow-ups.
        leadId: carriers[index % carriers.length].id,
        description: chance(0.85) ? pick(NOTES) : null,
        dueAt,
        endAt,
        completedAt:
          bucket === 'completed'
            ? new Date(dueAt.getTime() + between(1, 48) * 3_600_000)
            : null,
        createdAt: new Date(dueAt.getTime() - between(1, 20) * dayMs),
      };
    });

    await prisma.activity.createMany({ data: activities });
    console.log(`[dev-dataset] ${activities.length} activities created.`);

    // ── Activity assignees: 1–3 per activity, across every agent ─────────────
    const activityAssignees = activities.flatMap((activity, index) => {
      const count = chance(0.35) ? between(2, 3) : 1;
      const chosen = new Set<string>();
      chosen.add(agents[index % agents.length].id);
      while (chosen.size < count) chosen.add(pick(agents).id);
      return [...chosen].map((userId) => ({
        id: randomUUID(),
        activityId: activity.id,
        userId,
      }));
    });
    await prisma.activityAssignee.createMany({ data: activityAssignees });
    console.log(
      `[dev-dataset] ${activityAssignees.length} activity assignees created.`,
    );

    console.log('\n[dev-dataset] done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[dev-dataset] failed:', error);
  process.exit(1);
});
