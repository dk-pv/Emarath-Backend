-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "roles_deleted_at_parent_id_position_idx" ON "roles"("deleted_at", "parent_id", "position");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
