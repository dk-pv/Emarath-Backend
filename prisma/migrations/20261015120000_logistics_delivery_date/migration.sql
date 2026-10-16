-- Logistics delivery date (ADR-0094): the day an order is planned to be delivered.
--
-- Additive only: one nullable DATE column, no default and no backfill, so every existing order
-- stays without a date (shown as "No Delivery Date") and nothing guesses one. No index yet: the
-- bucket filters read a small table; add one when order volume shows a need.
--
-- Written by hand rather than by `prisma migrate dev`, which would also try to drop
-- activities.completion_note (in migration 20261007120000, not in schema.prisma — its future
-- is undecided) and is unusable while 20261008120000_remove_gps_module is still pending on the
-- shared development database.

ALTER TABLE "logistics_orders" ADD COLUMN "delivery_date" DATE;
