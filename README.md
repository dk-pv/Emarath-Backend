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

| Variable      | Default                 | Purpose                                          |
| ------------- | ----------------------- | ------------------------------------------------ |
| `NODE_ENV`    | `development`           | Selects the environment                          |
| `PORT`        | `5000`                  | HTTP port (Render injects this in production)    |
| `APP_NAME`    | `Emarath Backend`       | Service name shown in the health response        |
| `API_PREFIX`  | `api`                   | Global route prefix (`/api/...`)                 |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed frontend origin                          |

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
src/
├── config/
│   └── configuration.ts     # typed, namespaced app config (@nestjs/config)
├── health/
│   ├── health.controller.ts # GET /api/health
│   ├── health.service.ts    # liveness payload
│   └── health.module.ts
├── app.controller.ts
├── app.module.ts            # ConfigModule + HealthModule wiring
├── app.service.ts
└── main.ts                  # global prefix, CORS, bootstrap
```
