-- LEAD-03.1: fast substring search on Customer Name and Primary Phone.
-- gin_trgm_ops needs the pg_trgm extension, which Prisma does not manage here,
-- so it is enabled explicitly and idempotently before the indexes that use it.
-- Adding an extension is additive and non-destructive.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "leads_name_idx" ON "leads" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "leads_primary_phone_idx" ON "leads" USING GIN ("primary_phone" gin_trgm_ops);
