-- apps/order-service/prisma/migrations/20261121000000_init_order_schema/migration.sql
-- Migration khởi tạo cơ sở dữ liệu cho Ordering Bounded Context
-- Đảm bảo ACID Transactions, Constraints bảo vệ Invariants và Transactional Outbox

-- 1. Tạo Enums
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REJECTED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- 2. Tạo Bảng "orders"
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "total_amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'VND',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_orders" PRIMARY KEY ("id"),
    CONSTRAINT "chk_orders_total_amount_non_negative" CHECK ("total_amount" >= 0),
    CONSTRAINT "chk_orders_version_positive" CHECK ("version" >= 1)
);

-- 3. Tạo Bảng "order_items"
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_items" PRIMARY KEY ("id"),
    CONSTRAINT "fk_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chk_order_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "chk_order_items_unit_price_non_negative" CHECK ("unit_price" >= 0),
    CONSTRAINT "chk_order_items_subtotal_non_negative" CHECK ("subtotal" >= 0)
);

-- 4. Tạo Bảng "outbox_events" (Transactional Outbox Pattern)
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL DEFAULT 'Order',
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_outbox_events" PRIMARY KEY ("id")
);

-- 5. Tạo Unique Constraints & Indexes
CREATE UNIQUE INDEX "uq_orders_order_number" ON "orders"("order_number");
CREATE UNIQUE INDEX "uq_orders_idempotency_key" ON "orders"("idempotency_key");
CREATE UNIQUE INDEX "uq_order_items_order_product" ON "order_items"("order_id", "product_id");

CREATE INDEX "idx_orders_customer_id" ON "orders"("customer_id");
CREATE INDEX "idx_orders_status" ON "orders"("status");
CREATE INDEX "idx_orders_created_at" ON "orders"("created_at");

CREATE INDEX "idx_order_items_order_id" ON "order_items"("order_id");
CREATE INDEX "idx_order_items_product_id" ON "order_items"("product_id");

CREATE INDEX "idx_outbox_events_status_created" ON "outbox_events"("status", "created_at");

