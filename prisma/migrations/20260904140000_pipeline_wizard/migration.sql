-- AlterTable: additive stage fields for the Sales Pipeline wizard.
-- Every column carries a default, so the existing stage rows keep the exact behaviour
-- the Kanban board has always shown (open, no outcome, follow-up off).
ALTER TABLE "stages" ADD COLUMN "is_closed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stages" ADD COLUMN "outcome" VARCHAR(16);
ALTER TABLE "stages" ADD COLUMN "inclusion" VARCHAR(48) NOT NULL DEFAULT 'INCLUDE_IN_SALES_PIPELINE';
ALTER TABLE "stages" ADD COLUMN "probability" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stages" ADD COLUMN "require_follow_up" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: the wizard's access mode and cloned-template record.
ALTER TABLE "pipelines" ADD COLUMN "access_mode" VARCHAR(16) NOT NULL DEFAULT 'ALL_USERS';
ALTER TABLE "pipelines" ADD COLUMN "template_key" VARCHAR(48);

-- CreateTable
CREATE TABLE "pipeline_permissions" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "permission_type" VARCHAR(8) NOT NULL,
    "role_id" UUID,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_permissions_pipeline_id_idx" ON "pipeline_permissions"("pipeline_id");

-- AddForeignKey
ALTER TABLE "pipeline_permissions" ADD CONSTRAINT "pipeline_permissions_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_permissions" ADD CONSTRAINT "pipeline_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_permissions" ADD CONSTRAINT "pipeline_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
