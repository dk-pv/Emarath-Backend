-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL,
    "pipeline" VARCHAR(64) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "color" VARCHAR(32) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stages_pipeline_position_idx" ON "stages"("pipeline", "position");

-- CreateIndex
CREATE UNIQUE INDEX "stages_pipeline_name_key" ON "stages"("pipeline", "name");
