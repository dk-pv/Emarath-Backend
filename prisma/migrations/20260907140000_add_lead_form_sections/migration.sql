-- Settings > Data & Schema Management > Form Customization: form sections (ADR-0073).
--
-- Purely additive: one new table and one nullable column. Every existing form field keeps
-- its form, its position and its visibility, and sits in the ungrouped block until a
-- section is created for it. No row is dropped, renamed or rewritten.

-- CreateTable: a named group of fields on a configured form.
CREATE TABLE "lead_form_sections" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_form_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_form_sections_form_id_name_key" ON "lead_form_sections"("form_id", "name");
CREATE INDEX "lead_form_sections_form_id_position_idx" ON "lead_form_sections"("form_id", "position");

-- AddForeignKey: sections are owned child data, so they go with their form.
ALTER TABLE "lead_form_sections" ADD CONSTRAINT "lead_form_sections_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "lead_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: which section a field sits in. Nullable, so every existing row stays in the
-- ungrouped block exactly as it renders today.
ALTER TABLE "lead_form_fields" ADD COLUMN "section_id" UUID;

-- CreateIndex
CREATE INDEX "lead_form_fields_section_id_position_idx" ON "lead_form_fields"("section_id", "position");

-- AddForeignKey: SetNull, so removing a section returns its fields to the ungrouped block
-- rather than deleting them — a layout change must never drop a field off the form.
ALTER TABLE "lead_form_fields" ADD CONSTRAINT "lead_form_fields_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "lead_form_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
