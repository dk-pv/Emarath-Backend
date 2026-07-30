-- AUTH-01.2: whether an account may log in (AC4). Added NOT NULL with a DEFAULT true,
-- so existing rows are backfilled as active and no data is lost.
ALTER TABLE "users" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
