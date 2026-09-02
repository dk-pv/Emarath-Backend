-- Settings > Users & Access > Team Members: the four columns the roster shows that the
-- User model did not carry.
--
-- Purely additive and all nullable — every existing account predates these fields, so no
-- backfill and no default is needed, and no existing row changes.
--
-- `phone` is a contact/display field only. It is NOT a login identity: authentication
-- remains email + password (see the open R-3 phone-vs-email question in STATUS.md).

-- AlterTable
ALTER TABLE "users" ADD COLUMN "job_title" VARCHAR(120);
ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(32);
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "last_seen_at" TIMESTAMP(3);
