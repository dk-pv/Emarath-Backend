-- Client clarification of 2026-10-01 (QC + Logistics workflow).
--
-- Q1: QC is a separate role — one new UserRole value. Additive: no user's role moves.
-- Postgres cannot drop an enum value, so reverting means recreating the type.
--
-- Q9: an AWB is unique across orders. The plain index on awb_number becomes a unique one;
-- NULLs stay allowed (an order has no AWB until dispatch). Checked before applying: the
-- table held no duplicate AWB (it held no orders at all).

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'QC';

-- DropIndex
DROP INDEX "logistics_orders_awb_number_idx";

-- CreateIndex
CREATE UNIQUE INDEX "logistics_orders_awb_number_key" ON "logistics_orders"("awb_number");
