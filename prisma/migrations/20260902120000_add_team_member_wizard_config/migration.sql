-- Settings > Users & Access: the full "Create A Team Member" wizard's data (ADR-0055).
--
-- Purely additive. Three new tables (roles, lead_forms, user_module_permissions) and
-- nullable/defaulted columns on users. No existing column changes, no backfill needed:
-- a null role_id displays as the account's enum role, and every new boolean defaults to
-- the reference's fresh-member OFF state.
--
-- Authorization is untouched: users.role (the enum) remains the JWT claim and the
-- RolesGuard/scoping input; roles.base_role maps each named role onto it.

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "base_role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_forms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_module_permissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "can_view" BOOLEAN NOT NULL DEFAULT false,
    "can_add" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_module_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "lead_forms_name_key" ON "lead_forms"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_module_permissions_user_id_module_key" ON "user_module_permissions"("user_id", "module");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "first_name" VARCHAR(80);
ALTER TABLE "users" ADD COLUMN "last_name" VARCHAR(80);
ALTER TABLE "users" ADD COLUMN "role_id" UUID;
ALTER TABLE "users" ADD COLUMN "reporting_to_id" UUID;
ALTER TABLE "users" ADD COLUMN "lead_form_id" UUID;
ALTER TABLE "users" ADD COLUMN "pipelines" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "app_access" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "track_check_in_out" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "track_meeting_location" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "include_in_reporting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "auto_follow_up_prompt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "whatsapp_inbox_access" VARCHAR(20);
ALTER TABLE "users" ADD COLUMN "color_code" VARCHAR(9);
ALTER TABLE "users" ADD COLUMN "monthly_goal_amount" DECIMAL(12,2);
ALTER TABLE "users" ADD COLUMN "avatar_key" VARCHAR(300);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_reporting_to_id_fkey" FOREIGN KEY ("reporting_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_lead_form_id_fkey" FOREIGN KEY ("lead_form_id") REFERENCES "lead_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_permissions" ADD CONSTRAINT "user_module_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
