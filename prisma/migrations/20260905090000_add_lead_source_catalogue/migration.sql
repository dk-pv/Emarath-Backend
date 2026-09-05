-- CreateTable: the Lead Source catalogue (Settings → Sales & CRM Configuration).
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_name_key" ON "lead_sources"("name");

-- AddForeignKey: SetNull, so removing a user never removes the sources they added.
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Back-fill: every source value the existing leads already carry becomes a catalogue row.
-- `Lead.source` is free text and stays that way, so this adds rows without touching a
-- single lead — it only makes the values leads already hold manageable. Without it a lead
-- could sit on a source the catalogue does not list, and its rename/delete guards could
-- not see it. `created_by_id` is null: these predate the screen, and attributing them to
-- an arbitrary account would be a lie.
INSERT INTO "lead_sources" ("id", "name", "is_active", "created_by_id", "created_at", "updated_at")
SELECT gen_random_uuid(), src, true, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT btrim("source") AS src
  FROM "leads"
  WHERE "source" IS NOT NULL AND btrim("source") <> ''
) AS existing
ON CONFLICT ("name") DO NOTHING;
