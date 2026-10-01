-- Retention + audit foundation (ADR-0083): an append-only log of important changes.
--
-- Purely additive: one new table, three indexes and one foreign key. No existing table,
-- column or row is dropped, renamed or rewritten. History starts empty — nothing before
-- this migration was ever recorded, so nothing is backfilled or invented.

-- CreateTable: one row per change, written in the same transaction as the change.
-- entity_id and lead_id carry no foreign key on purpose: a lead's history must outlive a
-- hard delete of that lead.
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" UUID NOT NULL,
    "lead_id" UUID,
    "action" VARCHAR(48) NOT NULL,
    "actor_type" VARCHAR(16) NOT NULL,
    "actor_id" UUID,
    "source" VARCHAR(48) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one record's history, one customer journey's history, one user's actions.
CREATE INDEX "audit_events_entity_type_entity_id_created_at_idx" ON "audit_events"("entity_type", "entity_id", "created_at");
CREATE INDEX "audit_events_lead_id_created_at_idx" ON "audit_events"("lead_id", "created_at");
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

-- AddForeignKey: RESTRICT, because users are only ever soft-deleted and history must keep
-- naming who acted.
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
