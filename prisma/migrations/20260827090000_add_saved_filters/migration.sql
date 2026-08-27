-- CreateTable
CREATE TABLE "saved_filters" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "conditions" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_filters_user_id_idx" ON "saved_filters"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_filters_user_id_name_key" ON "saved_filters"("user_id", "name");

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

