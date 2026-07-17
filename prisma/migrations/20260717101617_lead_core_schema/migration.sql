-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPERADMIN', 'SALES_MANAGER', 'SALES_AGENT', 'CUSTOMER_SERVICE_AGENT', 'MARKETING_ANALYST');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "role" "UserRole" NOT NULL,
    "team" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "first_name" VARCHAR(120),
    "primary_phone" VARCHAR(32) NOT NULL,
    "secondary_phone" VARCHAR(32),
    "language" VARCHAR(64),
    "country" VARCHAR(64),
    "source" VARCHAR(64),
    "status" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignments" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "leads_status_deleted_at_idx" ON "leads"("status", "deleted_at");

-- CreateIndex
CREATE INDEX "leads_source_deleted_at_idx" ON "leads"("source", "deleted_at");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at" DESC);

-- CreateIndex
CREATE INDEX "lead_assignments_user_id_idx" ON "lead_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_assignments_lead_id_user_id_key" ON "lead_assignments"("lead_id", "user_id");

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
