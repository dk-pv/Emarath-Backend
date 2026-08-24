-- CreateEnum
CREATE TYPE "LeadCustomFieldType" AS ENUM ('TEXT', 'TEXTBOX', 'NUMBER', 'DATE', 'DATETIME');

-- CreateTable
CREATE TABLE "lead_custom_fields" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "type" "LeadCustomFieldType" NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lead_custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_custom_field_values" (
    "id" UUID NOT NULL,
    "custom_field_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_custom_fields_key_key" ON "lead_custom_fields"("key");

-- CreateIndex
CREATE INDEX "lead_custom_field_values_custom_field_id_idx" ON "lead_custom_field_values"("custom_field_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_custom_field_values_lead_id_custom_field_id_key" ON "lead_custom_field_values"("lead_id", "custom_field_id");

-- AddForeignKey
ALTER TABLE "lead_custom_field_values" ADD CONSTRAINT "lead_custom_field_values_custom_field_id_fkey" FOREIGN KEY ("custom_field_id") REFERENCES "lead_custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_custom_field_values" ADD CONSTRAINT "lead_custom_field_values_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

