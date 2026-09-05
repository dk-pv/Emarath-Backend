-- CreateEnum
CREATE TYPE "MessageTemplateType" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageTemplateStatus" AS ENUM ('ACTIVE', 'VERIFICATION_PENDING');

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "type" "MessageTemplateType" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "MessageTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_templates_deleted_at_type_idx" ON "message_templates"("deleted_at", "type");

-- CreateIndex
CREATE INDEX "message_templates_deleted_at_status_idx" ON "message_templates"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "message_templates_deleted_at_name_idx" ON "message_templates"("deleted_at", "name");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
