-- CreateEnum
CREATE TYPE "AssignmentAlgorithm" AS ENUM ('ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "AssignmentRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssignmentApplyTo" AS ENUM ('ALL_RECORDS');

-- CreateEnum
CREATE TYPE "AssignmentTarget" AS ENUM ('ALL_USERS');

-- CreateTable
CREATE TABLE "assignment_rules" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" VARCHAR(600) NOT NULL,
    "algorithm" "AssignmentAlgorithm" NOT NULL DEFAULT 'ROUND_ROBIN',
    "status" "AssignmentRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_rule_groups" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "position" INTEGER NOT NULL,
    "apply_to" "AssignmentApplyTo" NOT NULL DEFAULT 'ALL_RECORDS',
    "target" "AssignmentTarget" NOT NULL DEFAULT 'ALL_USERS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_rule_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignment_rules_deleted_at_status_idx" ON "assignment_rules"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "assignment_rules_deleted_at_name_idx" ON "assignment_rules"("deleted_at", "name");

-- CreateIndex
CREATE INDEX "assignment_rule_groups_rule_id_idx" ON "assignment_rule_groups"("rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_rule_groups_rule_id_position_key" ON "assignment_rule_groups"("rule_id", "position");

-- AddForeignKey
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_rule_groups" ADD CONSTRAINT "assignment_rule_groups_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "assignment_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
