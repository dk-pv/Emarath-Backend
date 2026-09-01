/**
 * Documents fixture — development only.
 *
 * The Documents list is fully wired to the API (DOC-01.1 → DOC-06.1) but the
 * database only ever held the two rows QA left behind, so the type filter, the
 * "Last Modified" sort and the populated table could not be exercised or shown.
 *
 * ADR-0053's pattern, as `seed-dev-dataset.ts` applies it: a separate, idempotent,
 * production-guarded script whose ids come from a fixed namespace, so a re-run
 * replaces only what it created and never a row a human or another fixture made.
 * Dates are relative to the run, so the list stays plausibly recent next month.
 *
 * One document per supported filter type (PNG, PDF, DOCX, XLSX, CSV, TXT), so the
 * "All Documents" dropdown has something to narrow to in every option.
 *
 * Users are NOT created: uploaders are drawn from the accounts the baseline seed
 * already provides, and every row goes through the real `Document` relations —
 * `uploaderId → User`, and a `DocumentAccess` grant per document.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const NAMESPACE = 'emarath.documents-fixture.v1';

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

/**
 * The fixture set. `contentType` is the real MIME type the storage layer would
 * report — the UI derives its short "png"/"pdf" label from it, so a wrong MIME
 * here would show the wrong Type and break the filter.
 *
 * `hoursAgo` spaces the rows out so "Date and Time" reads like real activity and
 * "Last Modified" has an unambiguous newest row.
 */
const DOCUMENTS = [
  {
    title: 'Product Images',
    fileName: 'product-images.png',
    contentType: 'image/png',
    sizeBytes: 1_729_331,
    category: 'Marketing',
    hoursAgo: 3,
  },
  {
    title: 'Company Profile',
    fileName: 'company-profile.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2_453_012,
    category: 'Company',
    hoursAgo: 27,
  },
  {
    title: 'Employee Handbook',
    fileName: 'employee-handbook.docx',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 848_204,
    category: 'HR',
    hoursAgo: 52,
  },
  {
    title: 'Sales Report',
    fileName: 'sales-report.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 312_889,
    category: 'Sales',
    hoursAgo: 76,
  },
  {
    title: 'Customer Import',
    fileName: 'customer-import.csv',
    contentType: 'text/csv',
    sizeBytes: 96_140,
    category: 'Sales',
    hoursAgo: 101,
  },
  {
    title: 'Project Notes',
    fileName: 'project-notes.txt',
    contentType: 'text/plain',
    sizeBytes: 12_486,
    category: null,
    hoursAgo: 126,
  },
] as const;

const HOUR_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The documents fixture is development-only and must not run in production.',
    );
  }

  const connectionString = process.env['DATABASE_URL_UNPOOLED'];
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is not set.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const uploaders = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { username: 'asc' },
    });
    if (uploaders.length === 0) {
      throw new Error('No users found — run `npm run seed:run` first.');
    }

    const now = Date.now();
    for (const [index, doc] of DOCUMENTS.entries()) {
      const id = fixtureId('document', index);
      // Spread the uploads over the accounts that exist, so "Uploaded By" is not
      // one name repeated six times.
      const uploader = uploaders[index % uploaders.length];
      const createdAt = new Date(now - doc.hoursAgo * HOUR_MS);
      const data = {
        title: doc.title,
        fileName: doc.fileName,
        // No object is uploaded: the fixture describes a file the storage layer
        // would hold. Downloads stay honest — DOC-02.x mints the signed URL.
        storageKey: `dev-fixture/documents/${doc.fileName}`,
        sizeBytes: doc.sizeBytes,
        contentType: doc.contentType,
        category: doc.category,
        uploaderId: uploader.id,
        createdAt,
        deletedAt: null,
      };

      await prisma.document.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });

      // One access grant per document, through the real join — the uploader can
      // always reach their own file, which is what the drawer's Select Users writes.
      const accessId = fixtureId('access', index);
      await prisma.documentAccess.upsert({
        where: { id: accessId },
        create: { id: accessId, documentId: id, userId: uploader.id },
        update: { documentId: id, userId: uploader.id },
      });
    }

    const total = await prisma.document.count({ where: { deletedAt: null } });
    console.log(
      `[documents] ${DOCUMENTS.length} fixture document(s) upserted across ` +
        `${new Set(DOCUMENTS.map((_, i) => i % uploaders.length)).size} uploader(s); ` +
        `${total} document(s) now live.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
