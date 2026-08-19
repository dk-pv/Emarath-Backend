-- CreateTable
CREATE TABLE "lead_pins" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_pins_user_id_idx" ON "lead_pins"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_pins_lead_id_user_id_key" ON "lead_pins"("lead_id", "user_id");

-- AddForeignKey
ALTER TABLE "lead_pins" ADD CONSTRAINT "lead_pins_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_pins" ADD CONSTRAINT "lead_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
