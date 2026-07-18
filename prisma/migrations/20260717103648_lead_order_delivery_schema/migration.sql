-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "actual_amount" DECIMAL(12,2),
ADD COLUMN     "booking_date" DATE,
ADD COLUMN     "category" VARCHAR(120),
ADD COLUMN     "city" VARCHAR(120),
ADD COLUMN     "forecasted_amount" DECIMAL(12,2),
ADD COLUMN     "national_code" VARCHAR(240),
ADD COLUMN     "payment_method" VARCHAR(64),
ADD COLUMN     "product" VARCHAR(180),
ADD COLUMN     "product2" VARCHAR(180),
ADD COLUMN     "product2_qty" DECIMAL(12,2),
ADD COLUMN     "product_qty" DECIMAL(12,2),
ADD COLUMN     "state" VARCHAR(120),
ADD COLUMN     "street" VARCHAR(240);

-- LEAD-01.2 AC5: money and quantities may never go negative.
-- Written by hand because Prisma cannot express a CHECK constraint in the
-- datamodel. A NULL passes: a CHECK only rejects a row when it evaluates FALSE,
-- and these columns are legitimately empty on leads with no commercial detail.
ALTER TABLE "leads" ADD CONSTRAINT "leads_actual_amount_non_negative" CHECK ("actual_amount" >= 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_forecasted_amount_non_negative" CHECK ("forecasted_amount" >= 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_qty_non_negative" CHECK ("product_qty" >= 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_product2_qty_non_negative" CHECK ("product2_qty" >= 0);
