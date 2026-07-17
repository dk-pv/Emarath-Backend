# Emarath Backend

API service for the **Emarath** ERP/CRM platform, built with [NestJS 11](https://nestjs.com/) and TypeScript.

This repository is intentionally **separate** from the frontend (`emarath-frontend`). The two apps are developed, versioned, and deployed independently.

- Backend (this repo) → deployed to **Render**
- Frontend → deployed to **Vercel**

> Scope note: this repository currently implements backlog task **FND-01.1 — Project scaffold & environments**. Database, authentication, and feature modules are added under their own approved backlog tasks.

---

## Prerequisites

| Tool    | Version (baseline)     |
| ------- | ---------------------- |
| Node.js | v22.13.1 (Node 20+ ok) |
| npm     | 11.6.2                 |

This project uses **npm** (not pnpm/yarn).

---

## Installation

```bash
npm install
```

Then create your local environment file from the template:

```bash
cp .env.example .env
```

---

## Environment configuration

Configuration is loaded through `@nestjs/config` and exposed as a typed `app`
namespace (`src/config/configuration.ts`). Application code reads values via
`ConfigService` — it never reads `process.env` directly.

The active environment is selected by **`NODE_ENV`**, with no code changes:

| Environment   | How it is selected                                   |
| ------------- | ---------------------------------------------------- |
| `development` | default when `NODE_ENV` is unset; local `.env` files |
| `staging`     | `NODE_ENV=staging` (real env vars on Render)         |
| `production`  | `NODE_ENV=production` (real env vars on Render)      |

Environment files are loaded in this order (first match wins), so hosted
platforms can rely purely on injected environment variables:

```
.env.<NODE_ENV>.local  →  .env.<NODE_ENV>  →  .env
```

### Variables

| Variable                | Default                 | Purpose                                                    |
| ----------------------- | ----------------------- | ---------------------------------------------------------- |
| `NODE_ENV`              | `development`           | Selects the environment                                    |
| `PORT`                  | `5000`                  | HTTP port (Render injects this in production)              |
| `APP_NAME`              | `Emarath Backend`       | Service name shown in the health response                  |
| `API_PREFIX`            | `api`                   | Global route prefix (`/api/...`)                           |
| `CORS_ORIGIN`           | `http://localhost:3000` | Allowed frontend origin                                    |
| `DATABASE_URL`          | _(none)_                | **Pooled** PostgreSQL URL used by the running application  |
| `DATABASE_URL_UNPOOLED` | _(none)_                | **Direct/unpooled** URL used by Prisma CLI migrations      |

See [`.env.example`](./.env.example). **Never commit real secrets** — only
`.env.example` is tracked; all other `.env*` files are git-ignored.

---

## Running locally

```bash
# development (watch mode) — http://localhost:5000
npm run start:dev

# development (no watch)
npm run start

# production build output
npm run start:prod
```

Select a different environment without changing code, e.g. staging:

```bash
# macOS/Linux/Git Bash
NODE_ENV=staging npm run start:prod

# Windows PowerShell
$env:NODE_ENV="staging"; npm run start:prod
```

The backend listens on **http://localhost:5000** with all routes under the
`/api` prefix.

---

## Health check

```
GET /api/health
```

Returns a lightweight liveness payload (no database dependency yet):

```json
{
  "status": "ok",
  "service": "Emarath Backend",
  "environment": "development",
  "timestamp": "2026-07-15T00:00:00.000Z",
  "uptime": 12.34
}
```

Quick check:

```bash
curl http://localhost:5000/api/health
```

The health endpoint is intentionally **database-independent** (liveness only), so
it keeps reporting `ok` even if the database is temporarily unavailable.

---

## Database (PostgreSQL + Prisma)

The database layer uses **PostgreSQL** with **Prisma 7** (`prisma-client`
generator + query compiler + node-postgres driver adapter).

### Connections

The schema/datasource and the runtime connection are configured separately:

- **Runtime application** connects through the driver adapter using the
  **pooled** `DATABASE_URL` (see `src/prisma/prisma.service.ts`). Startup
  connection failures are non-fatal — the process stays up and reconnects on
  demand.
- **Prisma CLI** (migrations, introspection) uses the **direct/unpooled**
  `DATABASE_URL_UNPOOLED`, configured in [`prisma.config.ts`](./prisma.config.ts).

Environment selection is unchanged from FND-01.1: each environment supplies its
own `DATABASE_URL` / `DATABASE_URL_UNPOOLED` via environment variables — no code
change. **Never commit real credentials.**

### Commands

```bash
npm run db:generate   # generate the Prisma client (also runs on postinstall)
npm run db:validate   # validate the schema
npm run db:migrate    # create + apply a migration locally (prisma migrate dev)*
npm run db:deploy     # apply committed migrations (staging/production)
npm run db:status     # show migration status
npm run db:seed       # run the seed script
npm run db:studio     # open Prisma Studio
```

\* `prisma migrate dev` requires a **shadow database**. With Neon, either set a
`shadowDatabaseUrl` (a separate Neon branch/database) in `prisma.config.ts`, or
use the **no-shadow workflow** below.

#### No-shadow migration workflow (Neon)

Edit `prisma/schema.prisma`, then diff the live database against it. Prisma 7
resolves the datasource from `prisma.config.ts`, so `--from-config-datasource`
takes no value:

```bash
mkdir -p prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<name>
npx prisma migrate diff \
  --from-config-datasource \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/<dir>/migration.sql
npm run db:deploy     # apply
npm run db:status     # verify
```

This generates **forward and reverse** migrations identically — the direction is
whatever the diff resolves to. Roll a change back by removing it from the schema
and re-running the same command; the diff emits the inverse DDL.

> **Prisma 7 removals — do not copy older guides.** `--from-schema-datasource`
> and `--to-schema-datamodel` were both removed. Use `--from-config-datasource`
> and `--to-schema`.

> **Never** use `prisma migrate reset` against a shared database. It drops
> everything, and it is not a rollback. Reverse migrations are the rollback
> mechanism (see the `20260717055921_drop_migration_check` migration).

**Deployed environments** run `npm run db:deploy` (never `migrate dev`) against
the environment's `DATABASE_URL_UNPOOLED`.

### Schema conventions (enforced in code review)

Every model MUST follow these conventions (see `prisma/schema.prisma`):

| Convention        | Rule                                                              |
| ----------------- | ---------------------------------------------------------------- |
| Primary key       | `id String @id @default(uuid()) @db.Uuid` → column `id`          |
| Created timestamp | `createdAt DateTime @default(now()) @map("created_at")`          |
| Updated timestamp | `updatedAt DateTime @updatedAt @map("updated_at")`               |
| Soft delete       | `deletedAt DateTime? @map("deleted_at")` (nullable; where needed)|
| Table naming      | `snake_case`, mapped via `@@map("...")`                          |
| Column naming     | `snake_case` in the DB via `@map("...")`; `camelCase` in Prisma  |
| Model naming      | `PascalCase`                                                     |

**Review checklist:** every schema PR is checked for the base fields above,
snake_case table/column mappings, and must pass `npm run db:validate` (and
`prisma format`).

> The schema contains **no domain models yet**. Feature schemas arrive under
> their own approved backlog tasks and must adopt the conventions above.

---

## Quality checks

```bash
npm run lint          # ESLint (auto-fix) — also enforces Prettier
npm run format        # Prettier: format src & test
npm run format:check  # Prettier: verify formatting (no writes)
npm run test          # Jest unit tests
npm run test:e2e      # Jest e2e tests
npm run build         # Compile to ./dist
```

---

## Build & production start

```bash
npm run build      # outputs to ./dist
npm run start:prod # runs node dist/main
```

---

## Project structure

```
prisma/
├── schema.prisma            # datasource, generator, conventions + models
├── migrations/              # versioned migration history (committed)
└── seed.ts                  # seed script (placeholder — no data yet)
prisma.config.ts             # Prisma 7 CLI config (schema, migrations, datasource)
src/
├── config/
│   └── configuration.ts     # typed, namespaced app config (@nestjs/config)
├── generated/prisma/        # generated Prisma client (git-ignored)
├── health/
│   ├── health.controller.ts # GET /api/health
│   ├── health.service.ts    # liveness payload
│   └── health.module.ts
├── prisma/
│   ├── prisma.service.ts    # PrismaClient + pg adapter, resilient connect
│   └── prisma.module.ts     # @Global PrismaModule
├── app.controller.ts
├── app.module.ts            # ConfigModule + PrismaModule + HealthModule wiring
├── app.service.ts
└── main.ts                  # global prefix, CORS, bootstrap
```
