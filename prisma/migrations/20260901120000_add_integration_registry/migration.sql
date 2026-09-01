-- INT-01.1 (ADR-0054): the integration library catalogue.
--
-- Purely additive: one new table, no change to any existing table, column or
-- constraint. `key` is unique so the reference-set seed is idempotent — re-running it
-- updates the row rather than inserting a duplicate.
--
-- App-global by design: the platform is single-tenant, so AC4's "per-organization
-- enablement" is the deployment. No tenant key, matching stages/tags/lead_custom_fields.

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(400) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "logo" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "detail_url" VARCHAR(300),
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrations_key_key" ON "integrations"("key");

-- CreateIndex
CREATE INDEX "integrations_deleted_at_position_idx" ON "integrations"("deleted_at", "position");
