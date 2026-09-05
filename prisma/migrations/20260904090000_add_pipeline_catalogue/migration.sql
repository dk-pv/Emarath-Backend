-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "short_code" VARCHAR(16),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_name_key" ON "pipelines"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_short_code_key" ON "pipelines"("short_code");

-- CreateIndex
CREATE INDEX "pipelines_is_default_idx" ON "pipelines"("is_default");

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
