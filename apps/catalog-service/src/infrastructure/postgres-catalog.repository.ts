// apps/catalog-service/src/infrastructure/postgres-catalog.repository.ts
// PostgreSQL Adapter cho Catalog Bounded Context (catalog_db)
// Triển khai CatalogRepository Port với PostgreSQL connection pooling

import type {
  CatalogRepository,
  ProductEntity,
} from '../catalog.controller.ts';

export class PostgresCatalogRepository implements CatalogRepository {
  private pool: any = null;
  private readonly connectionString: string;
  private isInitialized = false;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private async getPool(): Promise<any> {
    if (!this.pool) {
      try {
        const pg = await import('pg');
        const Pool = pg.default?.Pool || pg.Pool;
        this.pool = new Pool({
          connectionString: this.connectionString,
          connectionTimeoutMillis: 5000,
          ssl: false,
        });
      } catch (err) {
        console.warn('[PostgresCatalogRepository] pg driver not available, cannot connect:', err);
        throw err;
      }
    }
    return this.pool;
  }

  public async initSchema(): Promise<void> {
    if (this.isInitialized) return;
    try {
      const pool = await this.getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(64) PRIMARY KEY,
          sku VARCHAR(64) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          price DECIMAL(12, 2) NOT NULL CHECK (price >= 0),
          currency VARCHAR(10) NOT NULL DEFAULT 'VND',
          available_stock INT NOT NULL DEFAULT 0 CHECK (available_stock >= 0),
          is_deleted BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      `);

      // Seed sản phẩm nếu bảng rỗng
      const checkRes = await pool.query('SELECT COUNT(*) FROM products');
      if (parseInt(checkRes.rows[0].count, 10) === 0) {
        await pool.query(`
          INSERT INTO products (id, sku, name, description, price, currency, available_stock)
          VALUES 
            ('prod-001', 'IPHONE-15-PRO', 'iPhone 15 Pro Max 256GB Titan Tự Nhiên', 'Điện thoại Apple chip A17 Pro', 34990000, 'VND', 50),
            ('prod-002', 'MACBOOK-AIR-M3', 'MacBook Air 13 inch M3 16GB/512GB', 'Laptop siêu mỏng nhẹ chip M3', 32990000, 'VND', 30),
            ('prod-003', 'AIRPODS-PRO-2', 'Tai nghe Apple AirPods Pro 2 USB-C', 'Khử tiếng ồn chủ động ANC', 5990000, 'VND', 100),
            ('prod-004', 'KEYCHRON-Q1-PRO', 'Bàn phím cơ Keychron Q1 Pro Wireless', 'Bàn phím cơ CNC full nhôm', 4500000, 'VND', 25)
          ON CONFLICT (id) DO NOTHING;
        `);
      }
      this.isInitialized = true;
      console.log('[PostgresCatalogRepository] Schema initialized successfully in catalog_db');
    } catch (err) {
      console.error('[PostgresCatalogRepository] Error initializing schema:', err);
      throw err;
    }
  }

  public async findAll(): Promise<ProductEntity[]> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM products WHERE is_deleted = false ORDER BY created_at DESC');
    return res.rows.map((row: any) => this.mapRowToEntity(row));
  }

  public async findById(id: string): Promise<ProductEntity | null> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM products WHERE id = $1 AND is_deleted = false', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  public async findBySku(sku: string): Promise<ProductEntity | null> {
    if (!sku) return null;
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM products WHERE LOWER(sku) = LOWER($1) AND is_deleted = false', [sku]);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  public async save(entity: ProductEntity): Promise<ProductEntity> {
    const pool = await this.getPool();
    const res = await pool.query(
      `INSERT INTO products (id, sku, name, description, price, currency, available_stock, is_deleted, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         sku = EXCLUDED.sku,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         price = EXCLUDED.price,
         currency = EXCLUDED.currency,
         available_stock = EXCLUDED.available_stock,
         is_deleted = EXCLUDED.is_deleted,
         updated_at = NOW()
       RETURNING *`,
      [
        entity.id,
        entity.sku,
        entity.name,
        entity.description || null,
        entity.price,
        entity.currency || 'VND',
        entity.stock ?? 0,
        entity.isDeleted ?? false,
        entity.createdAt || new Date(),
        entity.updatedAt || new Date(),
      ]
    );
    return this.mapRowToEntity(res.rows[0]);
  }

  public async create(product: any): Promise<ProductEntity> {
    return this.save(product as ProductEntity);
  }

  public async updateStock(id: string, newStock: number): Promise<ProductEntity | null> {
    const pool = await this.getPool();
    const res = await pool.query(
      `UPDATE products SET available_stock = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newStock, id]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  public async clear(): Promise<void> {
    const pool = await this.getPool();
    await pool.query('DELETE FROM products');
  }

  private mapRowToEntity(row: any): ProductEntity {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description || undefined,
      price: Number(row.price),
      currency: row.currency || 'VND',
      stock: Number(row.available_stock || 0),
      internalCost: Math.round(Number(row.price) * 0.7),
      supplierId: 'SUPPLIER-DEFAULT-VN',
      supplierNotes: 'Hợp đồng đại lý tiêu chuẩn',
      isDeleted: Boolean(row.is_deleted),
      version: 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
