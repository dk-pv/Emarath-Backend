-- AlterTable: the Tags catalogue's Active/Inactive status.
-- Additive and defaulted, so every existing tag stays exactly as it was — active, and
-- still offered by the tag lookup. No lead or lead_tag row is touched.
ALTER TABLE "tags" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
