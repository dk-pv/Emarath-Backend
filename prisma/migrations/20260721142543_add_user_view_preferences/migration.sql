-- CreateTable
CREATE TABLE "user_view_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "view_key" VARCHAR(64) NOT NULL,
    "layout" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_view_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_view_preferences_user_id_view_key_key" ON "user_view_preferences"("user_id", "view_key");

-- AddForeignKey
ALTER TABLE "user_view_preferences" ADD CONSTRAINT "user_view_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
