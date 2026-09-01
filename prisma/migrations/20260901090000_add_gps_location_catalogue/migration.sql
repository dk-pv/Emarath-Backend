-- GPS-09.1: the site catalogue the location-verified completion gate measures against.
-- ADR-0027 left `activities.location_id` as a soft reference "whose catalogue is the
-- GPS module's (no FK until that table exists)". This creates that table and closes
-- the reference. Additive: no activity currently carries a location_id, so adding the
-- foreign key cannot orphan an existing row.

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "radius_meters" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_deleted_at_idx" ON "locations"("deleted_at");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
