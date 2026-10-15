-- Tag Permissions (ADR-0091): which tags a department or a single user may select, and who may
-- create tags. Purely additive — two new tables and one enum; no existing row is touched.
--
-- Compatibility: an empty table means "as before" (every active tag selectable, only an
-- administrator creates tags), so applying this migration changes nobody's access until the
-- Admin saves a policy.

-- CreateEnum
CREATE TYPE "TagAccessMode" AS ENUM ('ALL', 'LISTED');

-- CreateTable
CREATE TABLE "tag_access_policies" (
    "id" UUID NOT NULL,
    "department" VARCHAR(120),
    "user_id" UUID,
    "can_create" BOOLEAN,
    "tag_access" "TagAccessMode",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_access_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_access_grants" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tag_access_policies_department_key" ON "tag_access_policies"("department");

-- CreateIndex
CREATE UNIQUE INDEX "tag_access_policies_user_id_key" ON "tag_access_policies"("user_id");

-- CreateIndex
CREATE INDEX "tag_access_grants_tag_id_idx" ON "tag_access_grants"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_access_grants_policy_id_tag_id_key" ON "tag_access_grants"("policy_id", "tag_id");

-- AddForeignKey
ALTER TABLE "tag_access_policies" ADD CONSTRAINT "tag_access_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_access_grants" ADD CONSTRAINT "tag_access_grants_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "tag_access_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_access_grants" ADD CONSTRAINT "tag_access_grants_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A policy belongs to exactly one subject: a department's default or one user's override.
-- Prisma cannot express a CHECK, so the invariant lives here.
ALTER TABLE "tag_access_policies"
  ADD CONSTRAINT "tag_access_policies_one_subject_chk"
  CHECK (num_nonnulls("department", "user_id") = 1);

-- A department row is the default every member inherits, so it must say both things; only a
-- user override may leave a field null ("inherit").
ALTER TABLE "tag_access_policies"
  ADD CONSTRAINT "tag_access_policies_department_complete_chk"
  CHECK ("department" IS NULL OR ("can_create" IS NOT NULL AND "tag_access" IS NOT NULL));
