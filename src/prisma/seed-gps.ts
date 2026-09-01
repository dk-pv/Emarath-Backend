/**
 * GPS field-activity fixture — development only.
 *
 * The GPS Map screen is fully wired (GPS-04.1 → GPS-08.1) but the database held
 * **zero** check-ins and **zero** location points, so `/gps/locations` returned an
 * empty array: no map markers, four of five KPIs stuck at 0, and an always-empty
 * list view. Nothing about the map could be seen, let alone verified.
 *
 * ADR-0053's pattern, as `seed-dev-dataset.ts` and `seed-documents.ts` apply it: a
 * separate, idempotent, production-guarded script whose ids come from a fixed
 * namespace, so a re-run replaces only what it created and never a row a human or
 * another fixture made. A seeded PRNG keeps coordinates reproducible.
 *
 * Timestamps are relative to the run, and most of the activity lands **today**, so
 * the screen's default period (today) is populated whenever this is run rather than
 * rotting to a fixed date.
 *
 * Produces all five pin types the legend names, through the real relations:
 *   CHECK_IN             — a CheckIn with no activity
 *   LOCATION_CHECK_IN    — a CheckIn linked to an Activity
 *   CHECK_OUT            — a CheckIn that also carries checkOutAt + coordinates
 *   AUTOMATIC_TRACKING   — a LocationPoint
 *   FOLLOW_UP_COMPLETION — a completed Activity reached through its linked CheckIn
 *
 * Users and activities are NOT created: agents come from the accounts the baseline
 * seed provides, and location check-ins attach to activities that already exist.
 *
 * The one row this fixture writes that it did not create is `completedAt` on the
 * activities it links a check-in to: a visit that closes a follow-up completes it, so
 * the two timestamps have to agree or the completion pin lands outside the period its
 * own check-in sits in. It is bounded to the handful of activities linked here, and
 * only ever moves an already-completed activity's timestamp.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const NAMESPACE = 'emarath.gps-fixture.v1';

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

/** Mulberry32 — a seeded PRNG, so a re-run places every pin identically. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Kozhikode, the region the Workpex reference centres on. Pins scatter inside a
 * box roughly 12 km across, so the map fits them at a city zoom rather than
 * clustering them on one point or spanning the country.
 */
const CENTRE = { lat: 11.2588, lng: 75.7804 };
const SPREAD = 0.055;

/** Well inside PIN_QUERY_LIMIT (500 per query), so nothing the map draws is truncated. */
const CHECK_INS_TODAY = 26;
const CHECK_INS_EARLIER = 34;
const TRACKING_POINTS_TODAY = 48;
const TRACKING_POINTS_EARLIER = 40;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A working-hours instant `daysAgo` days back — field activity, not 3am. */
function fieldMoment(random: () => number, daysAgo: number): Date {
  const day = new Date(Date.now() - daysAgo * DAY_MS);
  day.setHours(8 + Math.floor(random() * 10), Math.floor(random() * 60), 0, 0);
  return day;
}

function coordinate(random: () => number): { lat: number; lng: number } {
  return {
    lat: Number((CENTRE.lat + (random() - 0.5) * SPREAD).toFixed(6)),
    lng: Number((CENTRE.lng + (random() - 0.5) * SPREAD).toFixed(6)),
  };
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The GPS fixture is development-only and must not run in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is not set.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const agents = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { username: 'asc' },
    });
    if (agents.length === 0) {
      throw new Error('No users found — run `npm run seed:run` first.');
    }

    // Completed activities give the FOLLOW_UP_COMPLETION pins somewhere real to
    // attach: a location check-in linked to one makes that activity a completion
    // pin too, which is exactly how getLocations derives them.
    const activities = await prisma.activity.findMany({
      where: { completedAt: { not: null }, deletedAt: null },
      select: { id: true },
      orderBy: { completedAt: 'desc' },
      take: 40,
    });

    // GPS-09.1: two sites and two location-tied follow-ups, so the completion gate
    // has something real to pass and fail against. One follow-up gets a check-in at
    // the site (completes), the other a check-in ~1.2 km away (blocked).
    const sites = [
      {
        key: 'depot',
        name: 'Kozhikode Depot',
        lat: CENTRE.lat,
        lng: CENTRE.lng,
      },
      {
        key: 'showroom',
        name: 'Mavoor Road Showroom',
        lat: CENTRE.lat + 0.012,
        lng: CENTRE.lng + 0.012,
      },
    ];
    const siteIds: Record<string, string> = {};
    for (const [index, site] of sites.entries()) {
      const id = fixtureId('location', index);
      siteIds[site.key] = id;
      const data = {
        name: site.name,
        lat: site.lat,
        lng: site.lng,
        deletedAt: null,
      };
      await prisma.location.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    }

    const random = makeRandom(20260831);
    const total = CHECK_INS_TODAY + CHECK_INS_EARLIER;
    let linked = 0;

    for (let index = 0; index < total; index += 1) {
      const id = fixtureId('check-in', index);
      const agent = agents[index % agents.length];
      const daysAgo = index < CHECK_INS_TODAY ? 0 : 1 + (index % 6);
      const checkInAt = fieldMoment(random, daysAgo);
      const at = coordinate(random);

      // Every third visit is tied to a follow-up, so LOCATION_CHECK_IN and
      // FOLLOW_UP_COMPLETION both have pins without swamping plain check-ins.
      const activity =
        index % 3 === 0 && linked < activities.length
          ? activities[linked++]
          : null;

      // Two in three visits are closed; the rest stay open, which is what an
      // afternoon mid-shift genuinely looks like.
      const closed = index % 3 !== 1;
      const out = closed ? coordinate(random) : null;

      const data = {
        agentId: agent.id,
        checkInAt,
        checkInLat: at.lat,
        checkInLng: at.lng,
        checkOutAt: closed
          ? new Date(checkInAt.getTime() + (1 + random() * 3) * HOUR_MS)
          : null,
        checkOutLat: out ? out.lat : null,
        checkOutLng: out ? out.lng : null,
        activityId: activity ? activity.id : null,
        deletedAt: null,
      };

      await prisma.checkIn.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });

      // Keep the follow-up's completion on the visit that closed it, so the
      // FOLLOW_UP_COMPLETION pin and its check-in share a period.
      if (activity) {
        await prisma.activity.update({
          where: { id: activity.id },
          data: { completedAt: data.checkOutAt ?? checkInAt },
        });
      }
    }

    // Passive tracking runs on a minority of the roster, so the agent panel shows a
    // real mix of "Tracking active" and "User tracking disabled" rather than claiming
    // every account reports its location.
    const tracked = agents.filter((_, index) => index % 3 === 0);
    const points = TRACKING_POINTS_TODAY + TRACKING_POINTS_EARLIER;
    for (let index = 0; index < points; index += 1) {
      const id = fixtureId('location-point', index);
      const agent = tracked[index % tracked.length];
      const daysAgo = index < TRACKING_POINTS_TODAY ? 0 : 1 + (index % 6);
      const at = coordinate(random);
      const data = {
        agentId: agent.id,
        recordedAt: fieldMoment(random, daysAgo),
        lat: at.lat,
        lng: at.lng,
      };

      await prisma.locationPoint.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    }

    // Tie two open follow-ups to the two sites and give each a check-in: one on
    // site, one far away. Nothing else about those activities is touched.
    const gateAgent = await prisma.user.findFirst({
      where: { email: 'admin@emarath.com', deletedAt: null },
      select: { id: true },
    });
    const gateAgentId = gateAgent?.id ?? agents[0].id;

    // Idempotent: reuse the follow-ups this fixture already tied to its own sites
    // before claiming new ones, or a re-run would tie a fresh pair every time and
    // leave a growing trail of location-tied activities behind it.
    const existingTargets = await prisma.activity.findMany({
      where: { deletedAt: null, locationId: { in: Object.values(siteIds) } },
      select: { id: true, locationId: true },
      orderBy: { dueAt: 'asc' },
    });
    const claimed = new Map(
      existingTargets.map((a) => [a.locationId as string, a.id]),
    );
    const spare = await prisma.activity.findMany({
      where: { completedAt: null, deletedAt: null, locationId: null },
      select: { id: true },
      orderBy: { dueAt: 'asc' },
      take: 2,
    });
    let spareIndex = 0;

    const GATE_CASES = [
      { site: 'depot', offset: 0.0004, label: 'on-site (completes)' },
      { site: 'showroom', offset: 0.02, label: 'too far (blocked)' },
    ];

    for (const [index, scenario] of GATE_CASES.entries()) {
      const siteId = siteIds[scenario.site];
      const site = sites.find((s) => s.key === scenario.site)!;
      const targetId = claimed.get(siteId) ?? spare[spareIndex++]?.id;
      if (!targetId) break;
      const target = { id: targetId };
      // The gate is checked against the *calling* user, so the fixture attaches these
      // check-ins to the admin account: it is the one login a developer or reviewer
      // can actually sign in as to exercise the gate by hand.
      const agentId = gateAgentId;

      await prisma.activity.update({
        where: { id: target.id },
        data: {
          location: { connect: { id: siteId } },
          // Assigned to the same account, so the follow-up is visible to whoever
          // signs in to test the gate.
          assignees: {
            connectOrCreate: {
              where: {
                activityId_userId: {
                  activityId: target.id,
                  userId: gateAgentId,
                },
              },
              create: { userId: gateAgentId },
            },
          },
        },
      });

      const id = fixtureId('gate-check-in', index);
      const data = {
        agentId,
        checkInAt: new Date(),
        checkInLat: Number((site.lat + scenario.offset).toFixed(6)),
        checkInLng: Number(site.lng.toFixed(6)),
        checkOutAt: null,
        checkOutLat: null,
        checkOutLng: null,
        activityId: target.id,
        deletedAt: null,
      };
      await prisma.checkIn.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
      console.log(
        `[gps] gate fixture: activity ${target.id} @ ${site.name} — ${scenario.label}`,
      );
    }

    const [checkInCount, pointCount] = await Promise.all([
      prisma.checkIn.count({ where: { deletedAt: null } }),
      prisma.locationPoint.count(),
    ]);
    console.log(
      `[gps] ${total} check-in(s) (${linked} tied to a follow-up) and ${points} ` +
        `tracking point(s) upserted (${tracked.length} of ${agents.length} agents tracked); ` +
        `${checkInCount} check-in(s) and ${pointCount} point(s) now live.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
