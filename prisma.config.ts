// Prisma configuration (Prisma 7).
// Prisma 7 does NOT auto-load .env, so load it explicitly for CLI commands.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // A single command, no `&&`: Prisma forwards the whole string on to the
    // runner, so a chain here is swallowed as arguments to the first program and
    // the seed silently never executes. The chain lives in the npm script.
    seed: 'npm run seed:run',
  },
  datasource: {
    // Prisma CLI (migrate / introspect) uses the DIRECT, UNPOOLED Neon
    // connection. The runtime application uses the pooled DATABASE_URL via the
    // driver adapter (see src/prisma/prisma.service.ts).
    url: process.env['DATABASE_URL_UNPOOLED'],
  },
});
