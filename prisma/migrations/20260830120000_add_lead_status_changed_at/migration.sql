-- AlterTable
ALTER TABLE "leads" ADD COLUMN "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: an existing lead's status has stood since the lead was created.
UPDATE "leads" SET "status_changed_at" = "created_at";

-- Kept true by the database rather than app code, so every write path — row actions,
-- board moves, pipeline moves, imports, raw SQL — is covered without remembering to set it.
-- ponytail: a Stage rename rewrites `status` text and bumps this too; track renames
-- separately if that ever matters.
CREATE OR REPLACE FUNCTION leads_touch_status_changed_at() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."status_changed_at" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_status_changed_at
  BEFORE UPDATE OF "status" ON "leads"
  FOR EACH ROW EXECUTE FUNCTION leads_touch_status_changed_at();
