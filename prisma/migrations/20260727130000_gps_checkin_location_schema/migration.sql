-- CreateTable
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_in_lat" DECIMAL(9,6) NOT NULL,
    "check_in_lng" DECIMAL(9,6) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "check_out_lat" DECIMAL(9,6),
    "check_out_lng" DECIMAL(9,6),
    "activity_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_points" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "check_ins_agent_id_check_in_at_idx" ON "check_ins"("agent_id", "check_in_at");

-- CreateIndex
CREATE INDEX "check_ins_activity_id_idx" ON "check_ins"("activity_id");

-- CreateIndex
CREATE INDEX "location_points_agent_id_recorded_at_idx" ON "location_points"("agent_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
