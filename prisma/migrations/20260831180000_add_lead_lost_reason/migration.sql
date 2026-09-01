-- AlterTable: one nullable column, no default, no backfill, no trigger, nothing dropped.
-- Historical LOST leads keep NULL and report as "No reason recorded" — a backfilled guess
-- would fabricate business data.
ALTER TABLE "leads" ADD COLUMN "lost_reason" VARCHAR(120);
