// Prisma configuration (Prisma 7).
// Prisma 7 does NOT auto-load .env, so load it explicitly for CLI commands.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Seed command (run via `prisma db seed`). Placeholder for FND-01.2 —
    // no reference/domain data is seeded (that is later backlog scope).
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    // Prisma CLI (migrate / introspect) uses the DIRECT, UNPOOLED Neon
    // connection. The runtime application uses the pooled DATABASE_URL via the
    // driver adapter (see src/prisma/prisma.service.ts).
    url: process.env['DATABASE_URL_UNPOOLED'],
  },
});
