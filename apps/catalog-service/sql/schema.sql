-- apps/catalog-service/sql/schema.sql
-- Database-per-service: Bounded Context Catalog (catalog_db)
-- Tuyệt đối không chứa bảng hay foreign key trỏ sang Inventory hoặc Order

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(64) PRIMARY KEY,
    sku VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(12, 2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'VND',
    initial_stock INT NOT NULL DEFAULT 0 CHECK (initial_stock >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);

-- Seed dữ liệu mẫu cho Catalog
INSERT INTO products (id, sku, name, description, price, currency, initial_stock)
VALUES 
    ('prod_1', 'SKU-IPHONE16', 'iPhone 16 Pro Max 256GB', 'Titanium Tự Nhiên', 34990000, 'VND', 15),
    ('prod_2', 'SKU-MACBOOK-M3', 'MacBook Air 15 M3 16GB/512GB', 'Midnight M3 Chip', 32990000, 'VND', 8),
    ('prod_3', 'SKU-AIRPODS-PRO', 'AirPods Pro 2 MagSafe USB-C', 'Chống ồn chủ động ANC', 5790000, 'VND', 25)
ON CONFLICT (id) DO NOTHING;
