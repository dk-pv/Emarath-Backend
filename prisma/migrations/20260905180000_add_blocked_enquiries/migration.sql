-- CreateTable: enquiries refused by Duplicate Settings' "Block, hard stop" mode.
-- Purely additive: no existing table or row is touched. A blocked enquiry never became a
-- lead, so it is recorded here rather than in `leads`, where it would corrupt every lead
-- count, list and report.
CREATE TABLE "blocked_enquiries" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "primary_phone" VARCHAR(32) NOT NULL,
    "secondary_phone" VARCHAR(32),
    "email" VARCHAR(180),
    "matched_lead_id" UUID,
    "matched_on" VARCHAR(24) NOT NULL,
    "blocked_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blocked_enquiries_created_at_idx" ON "blocked_enquiries"("created_at");

-- AddForeignKey: SetNull throughout, so removing a lead or a user never removes the
-- record that an enquiry was blocked.
ALTER TABLE "blocked_enquiries" ADD CONSTRAINT "blocked_enquiries_matched_lead_id_fkey" FOREIGN KEY ("matched_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "blocked_enquiries" ADD CONSTRAINT "blocked_enquiries_blocked_by_id_fkey" FOREIGN KEY ("blocked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
