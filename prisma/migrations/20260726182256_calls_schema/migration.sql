-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('ANSWERED', 'NO_ANSWER', 'BUSY');

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "lead_notes" TEXT,
    "call_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calls_started_at_idx" ON "calls"("started_at");

-- CreateIndex
CREATE INDEX "calls_agent_id_started_at_idx" ON "calls"("agent_id", "started_at");

-- CreateIndex
CREATE INDEX "calls_lead_id_deleted_at_idx" ON "calls"("lead_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
