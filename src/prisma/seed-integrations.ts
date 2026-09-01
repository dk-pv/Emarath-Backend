/**
 * The integration library reference set (INT-01.1 AC5).
 *
 * Loads the 18 integrations the Workpex library shows, transcribed from
 * `ui-reference/integrations/integrations-library-grid-top-web-form-card-hover.png` and
 * the frontend registry built from it, in the same grid order.
 *
 * **Idempotent, and non-destructive on re-run.** Rows are upserted by `key`
 * (ADR-0054 §2), and the update branch deliberately **omits `enabled`**: that column is
 * admin state written through `PATCH /api/integrations/:id`, so a re-seed after a deploy
 * refreshes the descriptive fields without silently switching an organisation's
 * integrations back off. Only a first insert sets `enabled`.
 *
 * Production-guarded like every other seed in this repo. The registry is reference data
 * rather than a fixture, so it may legitimately need loading in a real environment — but
 * that is a deliberate, human-run operation, not something a script decides.
 *
 * Lives under src/ rather than prisma/ for the reason `seed.ts` documents: the Prisma 7
 * client is emitted as TypeScript that only resolves once compiled.
 *
 * Power BI is deliberately absent. Workpex shows it; the Emarath backlog has no task for
 * it, and CLAUDE.md §1 makes "in Workpex but not the backlog" out of scope.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * The reference set, in the order the library grid shows it.
 *
 * `logo` holds the icon key the frontend already resolves, not an asset path: the
 * product ships no per-provider logo art (ADR-0054 §4). `detailUrl` carries the two
 * links currently shipped; the reference shows Workpex's "View" navigating to an
 * *internal* connection page, which is an open INT-02.1 parity item, so these are
 * recorded as-shipped rather than replaced with routes that do not exist.
 *
 * `enabled` reproduces the reference header's "2 Enabled Integrations". **Which** two
 * Workpex has enabled is not captured in any screenshot; Facebook and Whatsapp are the
 * pair the shipped frontend already assumes, kept here so the count matches without a
 * second, conflicting guess.
 */
const INTEGRATIONS = [
  {
    key: 'facebook',
    name: 'Facebook',
    description:
      'Connect Facebook to capture leads, manage campaigns, and sync audience data',
    category: 'Meta',
    logo: 'IconBrandFacebook',
    enabled: true,
    detailUrl: null,
  },
  {
    key: 'web-form',
    name: 'Web Form',
    description:
      'Use web forms to collect user data, track submissions, and sync leads easily',
    category: 'Third-party',
    logo: 'IconWorldWww',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'whatsapp',
    name: 'Whatsapp',
    description:
      'Manage chats and create leads from customer interactions on WhatsApp',
    category: 'Meta',
    logo: 'IconBrandWhatsapp',
    enabled: true,
    detailUrl: null,
  },
  {
    key: 'happilee',
    name: 'Happilee',
    description:
      'Capture messages from Happilee and convert them into leads in your system',
    category: 'Third-party',
    logo: 'IconMessageChatbot',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'wabis',
    name: 'Wabis',
    description:
      'Handle messaging, automate responses, and track communication efficiently',
    category: 'Third-party',
    logo: 'IconMessageCircle',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'double-tick',
    name: 'Double Tick',
    description:
      'Track message delivery, monitor engagement, and improve communication flow',
    category: 'Third-party',
    logo: 'IconChecks',
    enabled: false,
    detailUrl: 'https://doubletick.io',
  },
  {
    key: 'google-ads',
    name: 'Google Ads',
    description:
      'Track campaigns, capture leads, and measure ad performance in one place',
    category: 'Google',
    logo: 'IconBrandGoogle',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'wati',
    name: 'Wati',
    description:
      'Manage WhatsApp communication, automate replies, and track interactions',
    category: 'Third-party',
    logo: 'IconMessageDots',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'hal-api',
    name: 'Hal API',
    description:
      'Connect services, automate workflows, and enable smooth data exchange',
    category: 'Third-party',
    logo: 'IconApi',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'bonvoice',
    name: 'Bonvoice',
    description:
      'Manage calls, track interactions, and improve communication efficiency',
    category: 'Third-party',
    logo: 'IconPhoneCall',
    enabled: false,
    detailUrl: null,
  },
  {
    key: '3cx',
    name: '3CX',
    description:
      'Integrate 3CX telephony for contact lookup, search, and call journaling',
    category: 'Third-party',
    logo: 'IconPhone',
    enabled: false,
    detailUrl: 'https://www.3cx.com',
  },
  {
    key: 'zoho',
    name: 'Zoho',
    description:
      'Sync billing data, track invoices, and manage payments seamlessly',
    category: 'Zoho',
    logo: 'IconReceipt2',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'college-dunia',
    name: 'College Dunia',
    description:
      'Capture leads, manage student inquiries, and simplify admission flow',
    category: 'Third-party',
    logo: 'IconSchool',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'urban-chat',
    name: 'Urban Chat',
    description:
      'Handle live chats, automate replies, and boost customer engagement',
    category: 'Third-party',
    logo: 'IconMessages',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'voxbay',
    name: 'Voxbay',
    description:
      'Track calls, monitor interactions, and improve communication efficiency',
    category: 'Third-party',
    logo: 'IconPhoneCall',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'facebook-conversion-api',
    name: 'Facebook Conversion API',
    description:
      'This feature sends conversion events from Emarath to Facebook, allowing better ad tracking and optimization.',
    category: 'Meta',
    logo: 'IconBrandFacebook',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'india-mart',
    name: 'India Mart',
    description:
      'Sync IndiaMART leads directly into your CRM for faster lead management, automated inquiry capture, and streamlined follow-ups.',
    category: 'Third-party',
    logo: 'IconBuildingStore',
    enabled: false,
    detailUrl: null,
  },
  {
    key: 'telinfy',
    name: 'Telinfy',
    description:
      'Automatically sync leads from Telinfy to Emarath, avoiding manual data entry.',
    category: 'Third-party',
    logo: 'IconSend',
    enabled: false,
    detailUrl: null,
  },
] as const;

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The integration registry seed must not run unattended in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is not set.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    for (const [index, integration] of INTEGRATIONS.entries()) {
      const { key, enabled, ...reference } = integration;
      const position = index + 1;

      await prisma.integration.upsert({
        where: { key },
        create: { key, enabled, position, ...reference },
        // `enabled` is intentionally not updated: it is admin state, not reference
        // data. `deletedAt` is cleared so a re-seed restores an integration that was
        // soft-deleted, which is the only way to bring one back.
        update: { position, deletedAt: null, ...reference },
      });
    }

    const live = await prisma.integration.count({ where: { deletedAt: null } });
    const on = await prisma.integration.count({
      where: { deletedAt: null, enabled: true },
    });
    console.log(
      `[integrations] ${INTEGRATIONS.length} reference integration(s) upserted; ` +
        `${live} live, ${on} enabled.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
