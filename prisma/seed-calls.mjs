/**
 * Demo call records for the Call Dashboard (CALL-01.1 schema).
 *
 * The `calls` table ships empty because the live 3CX transport (CALL-02.1) is
 * deferred, which leaves every Call Dashboard KPI, the leaderboard, the three
 * analytics panels and the log reading zero. This seeds believable attempts
 * against the EXISTING leads and their EXISTING assigned agents, so the same
 * customer appears in Leads, Kanban, Activities and the Call Dashboard, and
 * role scoping (a call is visible when its lead is) works unchanged.
 *
 *   node prisma/seed-calls.mjs          # insert the 30-day log (idempotent on external_id)
 *   node prisma/seed-calls.mjs --today  # re-date the today slice onto the current day
 *   node prisma/seed-calls.mjs --purge  # remove every seeded row
 *
 * Every row carries external_id 'seed-call-<n>', so the demo data is removable
 * in one statement and can never collide with a real ingested call.
 *
 * `--today` exists because the log's timestamps are computed from the clock at
 * seed time: the rows written on day D sit on day D for ever, so the dashboard's
 * default Today period empties out the next morning. That mode owns its own
 * external_id range and UPSERTS, moving only `started_at` — so it is safe to run
 * every day, adds nothing on a second run, and never touches the 30-day history.
 */
import 'dotenv/config';
import pg from 'pg';

const PREFIX = 'seed-call-';
const TOTAL = 620;
/** Share of the log that lands in the last 24h, so "Today" is populated. */
const TODAY_SHARE = 0.18;
const DAYS_BACK = 30;

/** Deterministic PRNG — re-running produces the same log, so counts are stable. */
let seed = 20260829;
const rnd = () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const CALL_NOTES = [
  'Customer asked for a callback tomorrow morning.',
  'Shared the price list on WhatsApp.',
  'Confirmed delivery address for the order.',
  'Line was noisy, agreed to reconnect later.',
  'Discussed bulk pricing for 50 units.',
  'Customer is comparing quotes, will revert this week.',
  'Wrong number reached, contact updated.',
  'Follow-up scheduled after the site visit.',
  'Payment link sent during the call.',
  'Requested a sample before confirming.',
  null,
];

const LEAD_NOTES = [
  'Order confirmed.',
  'No need for now, will contact later.',
  'Interested but budget is tight this quarter.',
  'Existing customer, reorder expected.',
  'Asked not to be called again.',
  'Wants delivery before month end.',
  'QC - please state the reason.',
  null,
];

/** ANSWERED ~38%, NO_ANSWER ~47%, BUSY ~15% — the Workpex Call By Status shape. */
function outcomeFor() {
  const r = rnd();
  if (r < 0.38) return 'ANSWERED';
  if (r < 0.85) return 'NO_ANSWER';
  return 'BUSY';
}

const TODAY_PREFIX = `${PREFIX}today-`;
/**
 * Calls per agent for the today slice, busiest first. A real floor is nothing
 * like even: the top closer works several times the volume of the tail.
 */
const TODAY_WEIGHTS = [40, 32, 25, 20, 15, 12, 9, 7, 6, 5, 4, 3];
/** Every remaining agent with leads still shows a little activity, never zero. */
const TODAY_TAIL = 2;

/**
 * A moment earlier today. Calls land between the start of the working day and
 * now — never in the future, and never before the day has started, which matters
 * when the seed is run first thing in the morning.
 */
function todayInstant(now) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const workStart = dayStart.getTime() + 8 * 60 * 60 * 1000;
  const from =
    now.getTime() > workStart + 15 * 60 * 1000 ? workStart : dayStart.getTime();
  return new Date(from + Math.floor(rnd() * (now.getTime() - from)));
}

function startedAt(index) {
  const now = new Date();
  if (index < TOTAL * TODAY_SHARE) {
    // Today, spread across working hours.
    const d = new Date(now);
    d.setHours(int(8, Math.max(9, now.getHours())), int(0, 59), int(0, 59), 0);
    return d > now ? now : d;
  }
  const d = new Date(now);
  d.setDate(d.getDate() - int(1, DAYS_BACK));
  d.setHours(int(8, 19), int(0, 59), int(0, 59), 0);
  return d;
}

const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

if (process.argv.includes('--purge')) {
  const { rowCount } = await client.query(
    `delete from calls where external_id like $1`,
    [`${PREFIX}%`],
  );
  console.log(`removed ${rowCount} seeded call(s)`);
  await client.end();
  process.exit(0);
}

// A lead is callable when it has a phone and at least one assigned agent — the
// agent must be the lead's own, or the call would be invisible to them.
const { rows: leads } = await client.query(`
  select l.id, l.primary_phone, a.user_id
  from leads l
  join lead_assignments a on a.lead_id = l.id
  where l.deleted_at is null and l.primary_phone is not null
`);

if (leads.length === 0) {
  console.error('no assigned leads with a phone number — seed the leads first');
  await client.end();
  process.exit(1);
}

/** One call row, ready for the shared INSERT column list. */
function callRow(externalId, lead, at) {
  const outcome = outcomeFor();
  // A real PBX logs an unanswered attempt at (near) zero seconds; only a
  // connected call accrues talk time.
  const duration =
    outcome === 'ANSWERED' ? int(25, 640) : rnd() < 0.15 ? int(1, 6) : 0;
  // Inbound is the minority in an outbound sales floor, matching the reference.
  const direction = rnd() < 0.08 ? 'INBOUND' : 'OUTBOUND';
  return [
    externalId,
    lead.id,
    lead.user_id,
    lead.primary_phone,
    at.toISOString(),
    direction,
    outcome,
    duration,
    pick(LEAD_NOTES),
    pick(CALL_NOTES),
    // A recording exists only for a connected call, and not for all of them.
    outcome === 'ANSWERED' && rnd() < 0.35
      ? `https://recordings.invalid/${externalId}.mp3`
      : null,
    rnd() < 0.06,
  ];
}

const COLUMNS = `insert into calls (id, external_id, lead_id, agent_id, phone, started_at,
                      direction, outcome, duration, lead_notes, call_notes,
                      audio_url, flagged, created_at, updated_at)`;

function valuesClause(rows) {
  return rows
    .map((row, i) => {
      const base = i * row.length;
      return `(gen_random_uuid(),${row.map((_, j) => `$${base + j + 1}`).join(',')},now(),now())`;
    })
    .join(',');
}

/**
 * The rolling today slice: each eligible agent gets a weighted share of the
 * day's calls, always against their OWN assigned leads so role scoping sees
 * exactly what the board claims. Re-running upserts `started_at` onto the
 * current day and leaves every other column alone, so the metrics are stable
 * from one day to the next while the period keeps working.
 */
async function seedToday(client, leads) {
  const byAgent = new Map();
  for (const lead of leads) {
    const list = byAgent.get(lead.user_id) ?? [];
    list.push(lead);
    byAgent.set(lead.user_id, list);
  }
  // Busiest agents first, so the heaviest weights land on the agents actually
  // carrying the most leads. The id tiebreak keeps the assignment stable.
  const agents = [...byAgent.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const now = new Date();
  const rows = [];
  const plan = [];
  agents.forEach(([agentId, agentLeads], index) => {
    const count = TODAY_WEIGHTS[index] ?? TODAY_TAIL;
    plan.push({ agentId, count });
    for (let n = 0; n < count; n += 1) {
      rows.push(
        callRow(
          `${TODAY_PREFIX}${index}-${n}`,
          pick(agentLeads),
          todayInstant(now),
        ),
      );
    }
  });

  const params = rows.flat();
  const { rowCount } = await client.query(
    `${COLUMNS} values ${valuesClause(rows)}
     on conflict (external_id) do update
       set started_at = excluded.started_at, updated_at = now()`,
    params,
  );
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  console.log(
    `today slice: ${rowCount} call(s) across ${agents.length} agent(s), ` +
      `dated into [${dayStart.toISOString()}, ${now.toISOString()})`,
  );
  console.log(
    `per-agent: ${plan
      .slice(0, 12)
      .map((p) => p.count)
      .join(', ')}${agents.length > 12 ? `, then ${TODAY_TAIL} each` : ''}`,
  );
}

if (process.argv.includes('--today')) {
  await seedToday(client, leads);
  await client.end();
  process.exit(0);
}

const rows = [];
for (let i = 0; i < TOTAL; i += 1) {
  rows.push(callRow(`${PREFIX}${i}`, pick(leads), startedAt(i)));
}

const { rowCount } = await client.query(
  `${COLUMNS} values ${valuesClause(rows)}
   on conflict (external_id) do nothing`,
  rows.flat(),
);
console.log(
  `inserted ${rowCount} call(s) across ${leads.length} assigned leads`,
);
await client.end();
