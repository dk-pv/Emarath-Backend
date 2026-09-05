-- AlterTable: wizard step 3 — Pipeline Settings and Lead Expiry Settings.
-- Purely additive. Every column is nullable or defaulted, so the pipelines that predate
-- step 3 keep behaving exactly as before: expiry off, nothing configured.
ALTER TABLE "pipelines" ADD COLUMN "default_stage_id" UUID;
ALTER TABLE "pipelines" ADD COLUMN "mandatory_value_stage_id" UUID;
ALTER TABLE "pipelines" ADD COLUMN "qualified_stage_id" UUID;
ALTER TABLE "pipelines" ADD COLUMN "auto_convert_at_won" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pipelines" ADD COLUMN "expiry_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pipelines" ADD COLUMN "expiry_scope" VARCHAR(24);
ALTER TABLE "pipelines" ADD COLUMN "expiry_days" INTEGER;
ALTER TABLE "pipelines" ADD COLUMN "expired_stage_id" UUID;
ALTER TABLE "pipelines" ADD COLUMN "reassigned_stage_id" UUID;
ALTER TABLE "pipelines" ADD COLUMN "reassign_expired_to_id" UUID;

-- AddForeignKey: ON DELETE SET NULL throughout — removing a stage or a user clears the
-- setting that named it rather than blocking the delete or leaving a dangling id.
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_default_stage_id_fkey" FOREIGN KEY ("default_stage_id") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_mandatory_value_stage_id_fkey" FOREIGN KEY ("mandatory_value_stage_id") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_qualified_stage_id_fkey" FOREIGN KEY ("qualified_stage_id") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_expired_stage_id_fkey" FOREIGN KEY ("expired_stage_id") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_reassigned_stage_id_fkey" FOREIGN KEY ("reassigned_stage_id") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_reassign_expired_to_id_fkey" FOREIGN KEY ("reassign_expired_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
