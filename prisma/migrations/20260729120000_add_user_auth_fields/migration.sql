-- AUTH-01.1: add authentication fields to users (username + password hash).
--
-- Added nullable first, then backfilled for existing rows so no data is lost, then
-- set NOT NULL. bcrypt cannot run in SQL, so existing rows get a non-loginable
-- sentinel hash ('!', which no bcrypt verify can ever match); the seed replaces it
-- with a real bcrypt hash for the seeded accounts.

-- 1. Add columns nullable.
ALTER TABLE "users" ADD COLUMN "username" VARCHAR(120);
ALTER TABLE "users" ADD COLUMN "password_hash" VARCHAR(255);

-- 2. Backfill existing rows. Username from the email local-part (the seed accounts
--    have distinct local parts); password left fail-closed until seeded/reset.
UPDATE "users" SET "username" = split_part("email", '@', 1) WHERE "username" IS NULL;
UPDATE "users" SET "password_hash" = '!' WHERE "password_hash" IS NULL;

-- 3. Enforce NOT NULL now that every row has a value.
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL;

-- 4. AC5: username is unique (email is already unique).
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
