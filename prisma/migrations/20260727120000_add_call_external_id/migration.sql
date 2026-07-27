-- AlterTable
ALTER TABLE "calls" ADD COLUMN "external_id" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "calls_external_id_key" ON "calls"("external_id");
