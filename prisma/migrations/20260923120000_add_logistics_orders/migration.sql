-- CreateEnum
CREATE TYPE "LogisticsStatus" AS ENUM ('INITIAL', 'QC_VERIFIED', 'QC_REJECTED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RTO');

-- CreateTable
CREATE TABLE "logistics_orders" (
    "id" UUID NOT NULL,
    "order_number" SERIAL NOT NULL,
    "lead_id" UUID NOT NULL,
    "status" "LogisticsStatus" NOT NULL DEFAULT 'INITIAL',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "converted_at" TIMESTAMP(3) NOT NULL,
    "converted_by_id" UUID,
    "customer_name" VARCHAR(180) NOT NULL,
    "primary_phone" VARCHAR(32) NOT NULL,
    "secondary_phone" VARCHAR(32),
    "email" VARCHAR(180),
    "country" VARCHAR(64),
    "state" VARCHAR(120),
    "city" VARCHAR(120),
    "street" VARCHAR(240),
    "national_code" VARCHAR(240),
    "product" VARCHAR(180),
    "product_qty" DECIMAL(12,2),
    "product2" VARCHAR(180),
    "product2_qty" DECIMAL(12,2),
    "order_value" DECIMAL(12,2),
    "payment_method" VARCHAR(64),
    "qc_decided_at" TIMESTAMP(3),
    "qc_remarks" VARCHAR(2000),
    "awb_number" VARCHAR(64),
    "courier" VARCHAR(64),
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(500),
    "rto_at" TIMESTAMP(3),
    "rto_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_orders_order_number_key" ON "logistics_orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_orders_lead_id_key" ON "logistics_orders"("lead_id");

-- CreateIndex
CREATE INDEX "logistics_orders_status_created_at_idx" ON "logistics_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "logistics_orders_converted_at_idx" ON "logistics_orders"("converted_at");

-- CreateIndex
CREATE INDEX "logistics_orders_converted_by_id_converted_at_idx" ON "logistics_orders"("converted_by_id", "converted_at");

-- CreateIndex
CREATE INDEX "logistics_orders_awb_number_idx" ON "logistics_orders"("awb_number");

-- AddForeignKey
ALTER TABLE "logistics_orders" ADD CONSTRAINT "logistics_orders_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_orders" ADD CONSTRAINT "logistics_orders_converted_by_id_fkey" FOREIGN KEY ("converted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
