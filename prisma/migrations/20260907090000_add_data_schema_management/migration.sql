-- Settings > Data & Schema Management (ADR-0072).
--
-- Purely additive throughout: one new enum value, two new tables, and new columns that
-- all carry defaults, so every existing row keeps the meaning it has today. Nothing is
-- dropped, renamed or rewritten — no custom field, no form assignment and no lead value
-- changes as a result of this migration.

-- AlterEnum: the sixth field type. An existing definition keeps its current type.
ALTER TYPE "LeadCustomFieldType" ADD VALUE 'DROP_DOWN';

-- AlterTable: a custom field can now be deactivated without losing its stored values.
-- Defaulting to true keeps every field that exists today exactly as active as it was.
ALTER TABLE "lead_custom_fields" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex: the settings list pages live fields in display order.
CREATE INDEX "lead_custom_fields_deleted_at_position_idx" ON "lead_custom_fields"("deleted_at", "position");

-- CreateTable: the selectable values of a DROP_DOWN field.
CREATE TABLE "lead_custom_field_options" (
    "id" UUID NOT NULL,
    "custom_field_id" UUID NOT NULL,
    "label" VARCHAR(180) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_custom_field_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_custom_field_options_custom_field_id_label_key" ON "lead_custom_field_options"("custom_field_id", "label");
CREATE INDEX "lead_custom_field_options_custom_field_id_position_idx" ON "lead_custom_field_options"("custom_field_id", "position");

-- AddForeignKey: options are owned child data, so they go with their field.
ALTER TABLE "lead_custom_field_options" ADD CONSTRAINT "lead_custom_field_options_custom_field_id_fkey" FOREIGN KEY ("custom_field_id") REFERENCES "lead_custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: the seeded lead form catalogue becomes the configurable form it was
-- always scoped to become. Every column defaults, so the seeded "Custom Lead Form" and
-- every user already assigned to it are unaffected.
ALTER TABLE "lead_forms" ADD COLUMN "module" VARCHAR(40) NOT NULL DEFAULT 'LEAD';
ALTER TABLE "lead_forms" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "lead_forms" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lead_forms" ADD COLUMN "created_by_name" VARCHAR(120);

-- CreateIndex
CREATE INDEX "lead_forms_deleted_at_module_idx" ON "lead_forms"("deleted_at", "module");

-- CreateTable: which fields a form shows, in what order, and which are hidden.
CREATE TABLE "lead_form_fields" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "field_key" VARCHAR(64) NOT NULL,
    "position" INTEGER NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_form_fields_form_id_field_key_key" ON "lead_form_fields"("form_id", "field_key");
CREATE INDEX "lead_form_fields_form_id_position_idx" ON "lead_form_fields"("form_id", "position");

-- AddForeignKey
ALTER TABLE "lead_form_fields" ADD CONSTRAINT "lead_form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "lead_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
