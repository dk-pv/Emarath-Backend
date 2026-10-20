-- Accounts v1 (ADR-0096): the payment record a delivered order gets (client specification §4
-- steps 11-12, §6).
--
-- Additive only: one new enum type, one new table, its two indexes and its key to
-- logistics_orders. No existing table, column, type or row is changed, and nothing is backfilled:
-- an order delivered before this migration has no record (backfilling is an open owner decision).
--
-- Written by hand rather than by `prisma migrate dev`, which would also try to drop
-- activities.completion_note (in migration 20261007120000, not in schema.prisma — its future is
-- undecided) and is unusable while 20261008120000_remove_gps_module is still pending on the shared
-- development database. The statements are exactly what `prisma migrate diff` gives between the
-- previous schema.prisma and this one, so they touch nothing outside the new objects.
--
-- Postgres cannot drop an enum value: removing one of these five statuses later means recreating
-- the type. All five are the client's own (specification §6).

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIAL', 'PAYMENT_PENDING', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'PARTIALLY_PAID');

-- CreateTable
CREATE TABLE "accounts_records" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIAL',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_records_order_id_key" ON "accounts_records"("order_id");

-- CreateIndex
CREATE INDEX "accounts_records_status_created_at_idx" ON "accounts_records"("status", "created_at");

-- AddForeignKey
ALTER TABLE "accounts_records" ADD CONSTRAINT "accounts_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "logistics_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
