-- Duplicate lead relationship (ADR-0092): the earlier lead a new lead was received as a
-- duplicate of. One nullable self-referencing column on "leads"; no existing row is touched
-- and none is back-filled — leads that already share a phone stay findable through the
-- existing "Duplicate Lead" search scope and the Duplicate Enquiries report.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "duplicate_of_id" UUID;

-- CreateIndex
CREATE INDEX "leads_duplicate_of_id_idx" ON "leads"("duplicate_of_id");

-- AddForeignKey: hard-deleting the original clears the link instead of blocking the delete or
-- deleting the duplicate; soft-deleting (archiving) it leaves the link in place.
ALTER TABLE "leads" ADD CONSTRAINT "leads_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A lead is never a duplicate of itself. Prisma cannot express a CHECK, so the invariant lives here.
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_duplicate_of_not_self_chk"
  CHECK ("duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id");
