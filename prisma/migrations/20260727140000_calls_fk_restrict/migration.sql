-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_agent_id_fkey";

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
