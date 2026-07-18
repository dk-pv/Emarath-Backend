-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "call_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "call_status" VARCHAR(64),
ADD COLUMN     "whatsapp_attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "details" TEXT NOT NULL,
    "status" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "lead_tags_tag_id_idx" ON "lead_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_tags_lead_id_tag_id_key" ON "lead_tags"("lead_id", "tag_id");

-- CreateIndex
CREATE INDEX "complaints_lead_id_deleted_at_idx" ON "complaints"("lead_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- LEAD-01.3 AC5: counters start at zero and only ever count upwards, so a
-- negative is always a bug. Hand-written: Prisma cannot express CHECK.
ALTER TABLE "leads" ADD CONSTRAINT "leads_call_attempts_non_negative" CHECK ("call_attempts" >= 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_whatsapp_attempts_non_negative" CHECK ("whatsapp_attempts" >= 0);
