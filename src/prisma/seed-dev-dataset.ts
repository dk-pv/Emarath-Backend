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
/**
 * How many people the leaderboard ranks. Ten across 280 leads averages ~28 each,
 * the order of magnitude the reference board shows (37, 157, 31), instead of the
 * one-or-two a full-org round-robin produced.
 */
const CORE_TEAM_SIZE = 10;
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
        deletedAt: null,
        role: {
          in: ['SALES_AGENT', 'SALES_MANAGER', 'CUSTOMER_SERVICE_AGENT'],
        },
      },
      select: { id: true, name: true, role: true },
      orderBy: { username: 'asc' },
    });
    if (agents.length === 0) {
      throw new Error(
        'No assignable agents found — run `npm run seed:run` first.',
      );
    }

    /**
     * The desk that actually carries the book.
     *
     * Round-robining every assignable user gave 42 leaderboard rows of one to
     * three leads each — a board that ranks nobody, and a sales agent whose own
     * Dashboard showed two leads. Real desks are not flat: a core team owns the
     * volume and the rest of the org appears occasionally. Capped and ordered by
     * username so the same people are the core on every run.
     */
    const owners = agents
      .filter(
        (agent) =>
          agent.role === 'SALES_AGENT' || agent.role === 'SALES_MANAGER',
      )
      .slice(0, CORE_TEAM_SIZE);
    if (owners.length === 0) {
      throw new Error(
        'No sales agents or managers found — run `npm run seed:run` first.',
      );
    }

    // ── Revenue targets for the core desk ────────────────────────────────────
    //
    // Without a monthly goal the leaderboard's "% Revenue Target Achieved" reads
    // NA for everyone and the Team Revenue rail has no denominator, so the widget
    // cannot be reviewed at all. A ladder rather than one figure, so the column
    // ranks; deliberately low at the top of the ladder so the strongest sellers
    // land ABOVE 100 % — the reference board runs to 4846 %, and the calculation
    // is explicitly uncapped (DASH-04.1 AC3).
    //
    // This updates one column on users the fixture did not create, so it is
    // written narrowly and idempotently: only the core desk, only the goal.
    const TARGET_LADDER = [40000, 55000, 70000, 85000, 100000];
    await Promise.all(
      owners.map((owner, index) =>
        prisma.user.update({
          where: { id: owner.id },
          data: {
            monthlyGoalAmount: String(
              TARGET_LADDER[index % TARGET_LADDER.length],
            ),
          },
        }),
      ),
    );
    console.log(
      `[dev-dataset] monthly revenue targets set on ${owners.length} core agents.`,
    );

    const stages = await prisma.stage.findMany({
      where: { pipeline: DEFAULT_PIPELINE },
      select: { name: true },
      orderBy: { position: 'asc' },
    });
    if (stages.length === 0) {
      throw new Error('No stages found — run `npm run seed:run` first.');
    }
    const statuses = stages.map((stage) => stage.name);

    // ── Dashboard Settings: which stages the summary row counts ──────────────
    //
    // `GET /api/dashboard/summary` returns exactly the cards Settings → Application
    // Controls → Dashboard Settings names, and correctly refuses to invent a
    // fallback when nothing is selected — so on a fresh database that widget is
    // empty however many leads exist. Seeding the *configuration* (not the
    // figures) is what populates it: the counts still come from the leads.
    //
    // Written only when unset, so a choice made in the UI is never overwritten.
    const SUMMARY_STAGES = [
      'New',
      'Initial Contact',
      'HOT',
      'SUPER HOT',
      'WON',
      'LOST',
    ];
    const dashboardKey = 'application.dashboard';
    const existingDashboard = await prisma.appSetting.findUnique({
      where: { key: dashboardKey },
      select: { value: true },
    });
    const chosen = existingDashboard?.value as
      { leadStage?: unknown[] } | undefined;
    if (!chosen?.leadStage?.length) {
      const available = new Set(
        (
          await prisma.stage.findMany({
            where: { pipeline: DEFAULT_PIPELINE },
            select: { name: true },
          })
        ).map((stage) => stage.name),
      );
      const value = {
        summaryMode: 'LEAD_STAGE',
        displayOnCards: 'BOTH',
        leadStage: SUMMARY_STAGES.filter((name) => available.has(name)).map(
          (fieldKey, position) => ({ fieldKey, position }),
        ),
        leadSource: [],
      };
      await prisma.appSetting.upsert({
        where: { key: dashboardKey },
        create: { key: dashboardKey, value },
        update: { value },
      });
      console.log(
        `[dev-dataset] dashboard summary configured with ${value.leadStage.length} stage cards.`,
      );
    }

    const tags = await prisma.tag.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { name: 'asc' },
    });

    // Categories are a database catalogue now (Settings → Category), like stages and tags.
    const categoryRows = await prisma.category.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { position: 'asc' },
    });
    const categories = categoryRows.map((row) => row.name);

    const sources = values(LOOKUP_DATA.sources);
    const languages = values(LOOKUP_DATA.languages);
    const callStatuses = values(LOOKUP_DATA.callStatus);
    const payments = values(LOOKUP_DATA.paymentMethods);
    const products = values(LOOKUP_DATA.products);

    console.log(
      `[dev-dataset] catalogues: ${agents.length} agents (${owners.length} core) · ${statuses.length} stages · ` +
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
      // `Call.leadId` is onDelete: Restrict — a call is a business record and must
      // never vanish because a lead row was tidied. The call fixture
      // (prisma/seed-calls.mjs) attaches its calls to whatever leads exist, so on
      // a re-run those point at the leads about to be replaced and block the
      // delete. They are removed first, deliberately and narrowly: only calls on
      // this fixture's own leads, which would be orphaned regardless. Calls on any
      // other lead are untouched.
      const strandedCalls = await prisma.call.deleteMany({
        where: { leadId: { in: leadIds } },
      });
      if (strandedCalls.count > 0) {
        console.log(
          `[dev-dataset] removed ${strandedCalls.count} calls attached to the previous run's leads.`,
        );
      }
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

    /**
     * Leads are not spread evenly across the board: a real pipeline is fattest at
     * the top and thins toward the outcome stages, and a flat distribution makes
     * the Sales Pipeline Overview a row of identical bars that communicates
     * nothing. Weights are relative, applied only to stages this database
     * actually has; any stage not named here still appears, at weight 1, so
     * adding a stage never silently drops it from the dataset.
     */
    const STATUS_WEIGHTS: Record<string, number> = {
      New: 30,
      'Initial Contact': 22,
      'Follow-Up': 18,
      Warm: 14,
      HOT: 13,
      'NOT ANSWER': 12,
      'NOT REACHEBLE': 10,
      Cold: 10,
      'SUPER HOT': 8,
      WON: 16,
      Converted: 9,
      'READY TO DISPATCH': 8,
      'DATE SHIPMENT': 7,
      LOST: 12,
      Cancel: 6,
      COMPLAINT: 5,
      'CS NUMBER Received': 5,
      'SALES REJECTED': 4,
      'QC NOT APPROVED': 3,
    };
    const statusPool = statuses.flatMap((status) =>
      Array.from({ length: STATUS_WEIGHTS[status] ?? 1 }, () => status),
    );

    /** The stages whose leads carry a deal-sized figure rather than a small one. */
    const HIGH_VALUE = new Set([
      'HOT',
      'SUPER HOT',
      'WON',
      'Converted',
      'READY TO DISPATCH',
    ]);
    /** Reached its outcome, so it has a status-change instant worth spreading. */
    const TERMINAL = new Set(['WON', 'Converted', 'LOST', 'Cancel']);

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

      // Computed before the record so the amount, the status-change instant and
      // the assignment date below can all derive from it — a lead cannot be
      // assigned or converted before it exists.
      //
      // Skewed toward recent days rather than spread flat over the 120. Flat put
      // only ~2 of the 31 hot leads inside the current month, so every widget
      // that defaults to This Month opened nearly empty while the data sat months
      // back. Squaring the draw lands about half the dataset in the last four
      // weeks and still leaves a long tail for the previous-month comparisons.
      const ageDays = Math.floor(120 * random() ** 2.2);
      const createdAt = new Date(
        startOfToday.getTime() - ageDays * dayMs - between(0, 86_399) * 1000,
      );
      const status = pick(statusPool);
      // A hot or won lead carries a deal-sized figure (AED 5k–45k); everything
      // else stays small, so the Hot Leads total and Team Revenue are dominated
      // by the leads that should dominate them rather than by background noise.
      const actualAmount = HIGH_VALUE.has(status)
        ? String(between(5, 45) * 1000 + between(0, 19) * 25)
        : chance(0.35)
          ? String(between(120, 4800))
          : null;
      // Terminal statuses get an instant somewhere between creation and now, so
      // "converted in this period" differs from "converted in the last" — without
      // it every conversion lands on the day the fixture ran and the month-over-
      // month widgets flatten. Prisma sets this column on insert; the
      // leads_status_changed_at trigger only maintains it on later updates.
      const statusChangedAt = TERMINAL.has(status)
        ? new Date(
            createdAt.getTime() +
              Math.floor(
                random() * Math.max(dayMs, Date.now() - createdAt.getTime()),
              ),
          )
        : createdAt;

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
        status,
        statusChangedAt,
        pipeline,
        product: chance(0.7) ? pick(products) : null,
        productQty: chance(0.7) ? String(between(1, 4)) : null,
        category: chance(0.8) ? pick(categories) : null,
        paymentMethod: chance(0.6) ? pick(payments) : null,
        callStatus: chance(0.9) ? pick(callStatuses) : null,
        callAttempts: between(0, 4),
        whatsappAttempts: between(0, 4),
        actualAmount,
        forecastedAmount: chance(0.5) ? String(between(150, 6000)) : null,
        // Spread over ~120 days so date-range filters have something to bite on.
        createdAt,
      };
    });

    await prisma.lead.createMany({ data: leads });
    console.log(`[dev-dataset] ${leads.length} leads created.`);

    // ── Lead assignments: every lead to 1–2 agents, spread across all of them ──
    //
    // `createdAt` is set explicitly and is NOT decorative. It doubles as Workpex's
    // "Assigned Date", and it is what the Todays Leads / Leads This Month counters,
    // the Team Revenue rail and the leaderboard's conversion-rate denominator all
    // filter on. Leaving it to default put every assignment on the instant the
    // fixture ran, so those widgets read the whole dataset on seed day and zero
    // ever after — the period filters had nothing to distinguish. Deriving it from
    // the lead's own creation (assigned 0–2 days later, never before it existed)
    // spreads it across the same ~120 days the leads occupy.
    const leadAssignments = leads.flatMap((lead, index) => {
      const count = chance(0.3) ? 2 : 1;
      const chosen = new Set<string>();
      // Round-robin the primary owner across the core desk so the leaderboard has
      // real volume to rank, then add the occasional second from the wider org so
      // the assignee filter still has overlaps and shared leads to match.
      chosen.add(owners[index % owners.length].id);
      while (chosen.size < count) chosen.add(pick(agents).id);
      const assignedAt = new Date(
        Math.min(
          lead.createdAt.getTime() + between(0, 2) * dayMs,
          startOfToday.getTime() + 86_399_000,
        ),
      );
      return [...chosen].map((userId) => ({
        id: randomUUID(),
        leadId: lead.id,
        userId,
        createdAt: assignedAt,
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
      // Same core desk as the leads: an agent's own Activities widget has to be
      // populated for the role-scoped view to be worth looking at.
      chosen.add(owners[index % owners.length].id);
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
