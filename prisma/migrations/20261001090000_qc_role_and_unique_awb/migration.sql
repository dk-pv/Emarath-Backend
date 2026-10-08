-- Client clarification of 2026-10-01 (QC + Logistics workflow).
--
-- Q1: QC is a separate role — one new UserRole value. Additive: no user's role moves.
-- Postgres cannot drop an enum value, so reverting means recreating the type.
--
-- Q9: an AWB is unique across orders — a unique index on awb_number; NULLs stay allowed (an
-- order has no AWB until dispatch). Checked before applying: the table held no duplicate AWB
-- (it held no orders at all). The existing plain index is kept, not dropped: CLAUDE.md §11
-- puts any schema drop behind explicit approval.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'QC';

-- CreateIndex
CREATE UNIQUE INDEX "logistics_orders_awb_number_key" ON "logistics_orders"("awb_number");
