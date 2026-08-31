-- AlterTable
ALTER TABLE "calls" ADD COLUMN "flagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calls" ADD COLUMN "audio_url" VARCHAR(500);
