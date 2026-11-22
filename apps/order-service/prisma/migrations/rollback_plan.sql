-- apps/order-service/prisma/migrations/rollback_plan.sql
-- Kế hoạch Rollback (Down-migration) tương ứng với 20261121000000_init_order_schema
-- Phục vụ quy trình Zero-Downtime Migration và bảo toàn tính toàn vẹn dữ liệu

BEGIN;

-- 1. Hủy các Indexes & Bảng phụ thuộc trước (theo thứ tự ngược lại)
DROP TABLE IF EXISTS "order_items" CASCADE;
DROP TABLE IF EXISTS "outbox_events" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;

-- 2. Hủy các Custom Types / Enums
DROP TYPE IF EXISTS "OutboxStatus";
DROP TYPE IF EXISTS "OrderStatus";

COMMIT;

