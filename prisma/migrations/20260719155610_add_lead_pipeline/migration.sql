-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "pipeline" VARCHAR(64) NOT NULL DEFAULT 'Lead Pipeline';

-- CreateIndex
CREATE INDEX "leads_pipeline_deleted_at_idx" ON "leads"("pipeline", "deleted_at");
