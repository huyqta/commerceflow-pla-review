-- apps/inventory-service/sql/schema.sql
-- Database-per-service: Bounded Context Inventory (inventory_db)
-- Độc lập hoàn toàn, hỗ trợ Atomic Conditional Update & Idempotent Reservation

CREATE TABLE IF NOT EXISTS inventory_stocks (
    product_id VARCHAR(64) PRIMARY KEY,
    available_stock INT NOT NULL DEFAULT 0 CHECK (available_stock >= 0),
    reserved_stock INT NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
    total_stock INT NOT NULL DEFAULT 0 CHECK (total_stock >= 0),
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_reservations (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL,
    items JSONB NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RELEASED', 'CONFIRMED')),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservations_order_id ON inventory_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_idempotency_key ON inventory_reservations(idempotency_key);

-- Seed dữ liệu mẫu tồn kho khớp với danh mục sản phẩm
INSERT INTO inventory_stocks (product_id, available_stock, reserved_stock, total_stock, version)
VALUES 
    ('prod_1', 15, 0, 15, 1),
    ('prod_2', 8, 0, 8, 1),
    ('prod_3', 25, 0, 25, 1)
ON CONFLICT (product_id) DO NOTHING;
