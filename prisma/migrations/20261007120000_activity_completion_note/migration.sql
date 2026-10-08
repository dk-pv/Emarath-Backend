-- The optional note written when a follow-up is marked complete (ADR-0086).
-- Additive and nullable: existing rows keep NULL, nothing is rewritten.
-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "completion_note" TEXT;
