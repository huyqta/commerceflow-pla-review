// apps/inventory-service/src/infrastructure/postgres-inventory.repository.ts
// PostgreSQL Adapter cho Inventory Bounded Context (inventory_db)
// Hỗ trợ Atomic Conditional Update, Anti-Overselling, Idempotency & ACID Transactions

import type {
  InventoryRepository,
  InventoryStock,
  ReservationItem,
  ReservationRecord,
} from '../application/reserve-stock.ts';

export class PostgresInventoryRepository implements InventoryRepository {
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
        console.warn('[PostgresInventoryRepository] pg driver not available, cannot connect:', err);
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
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_reservations_order_id ON inventory_reservations(order_id);
        CREATE INDEX IF NOT EXISTS idx_reservations_idempotency_key ON inventory_reservations(idempotency_key);
      `);

      // Seed tồn kho ban đầu nếu bảng rỗng
      const checkRes = await pool.query('SELECT COUNT(*) FROM inventory_stocks');
      if (parseInt(checkRes.rows[0].count, 10) === 0) {
        await pool.query(`
          INSERT INTO inventory_stocks (product_id, available_stock, reserved_stock, total_stock, version)
          VALUES 
            ('prod-001', 50, 0, 50, 1),
            ('IPHONE-15-PRO', 50, 0, 50, 1),
            ('prod-002', 30, 0, 30, 1),
            ('MACBOOK-AIR-M3', 30, 0, 30, 1),
            ('prod-003', 100, 0, 100, 1),
            ('AIRPODS-PRO-2', 100, 0, 100, 1),
            ('prod-004', 25, 0, 25, 1),
            ('KEYCHRON-Q1-PRO', 25, 0, 25, 1)
          ON CONFLICT (product_id) DO NOTHING;
        `);
      }
      this.isInitialized = true;
      console.log('[PostgresInventoryRepository] Schema initialized successfully in inventory_db');
    } catch (err) {
      console.error('[PostgresInventoryRepository] Error initializing schema:', err);
      throw err;
    }
  }

  public async getStock(productId: string): Promise<InventoryStock | null> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM inventory_stocks WHERE product_id = $1', [productId]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      productId: r.product_id,
      availableStock: Number(r.available_stock),
      reservedStock: Number(r.reserved_stock),
      totalStock: Number(r.total_stock),
      version: Number(r.version),
    };
  }

  public async getAllStocks(): Promise<InventoryStock[]> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM inventory_stocks ORDER BY product_id ASC');
    return res.rows.map((r: any) => ({
      productId: r.product_id,
      availableStock: Number(r.available_stock),
      reservedStock: Number(r.reserved_stock),
      totalStock: Number(r.total_stock),
      version: Number(r.version),
    }));
  }

  public async setStock(stock: InventoryStock): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO inventory_stocks (product_id, available_stock, reserved_stock, total_stock, version, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (product_id) DO UPDATE
       SET available_stock = EXCLUDED.available_stock,
           reserved_stock = EXCLUDED.reserved_stock,
           total_stock = EXCLUDED.total_stock,
           version = EXCLUDED.version,
           updated_at = NOW()`,
      [stock.productId, stock.availableStock, stock.reservedStock, stock.totalStock, stock.version]
    );
  }

  /**
   * ============================================================================
   * PATTERN: ATOMIC CONDITIONAL UPDATE & ANTI-OVERSELLING (Kiểm soát đồng thời)
   * ============================================================================
   * [Mục đích cho Junior Developer]:
   * 1. BÀI TOÁN FLASH SALE & RACE CONDITION:
   *    Giả sử trong kho chỉ còn 1 chiếc iPhone cuối cùng (`available_stock = 1`).
   *    Tại cùng một mili-giây, có 100 khách hàng cùng bấm nút "Đặt Mua".
   *    Nếu code theo cách ngây thơ thông thường (Read-Modify-Write):
   *       const stock = await db.query("SELECT available_stock FROM ..."); // cả 100 request đều đọc ra 1!
   *       if (stock >= 1) {
   *          await db.query("UPDATE ... SET available_stock = stock - 1"); // Cả 100 request đều update!
   *       }
   *    -> KẾT QUẢ: 100 người mua thành công 1 chiếc máy! Tồn kho bị âm -99!
   *       Cửa hàng không có hàng giao và đối mặt với khủng hoảng truyền thông!
   * 
   * 2. GIẢI PHÁP - ATOMIC CONDITIONAL UPDATE:
   *    Đẩy việc kiểm tra điều kiện xuống trực tiếp bộ xử lý nguyên tử của PostgreSQL:
   *    `UPDATE inventory_stocks ... WHERE product_id = $2 AND available_stock >= $1`
   *    - PostgreSQL có cơ chế Row-level Lock khi thực hiện câu lệnh UPDATE.
   *    - Request đầu tiên chạm vào hàng dữ liệu sẽ trừ tồn kho từ 1 về 0 (`rowCount = 1` -> Thành công).
   *    - 99 requests còn lại đến sau, mệnh đề `available_stock >= 1` lúc này là FALSE,
   *      nên PostgreSQL bỏ qua và trả về `rowCount = 0` -> Thất bại ngay lập tức!
   *    - Không cần dùng `SELECT ... FOR UPDATE` nặng nề, không sợ Deadlock!
   */
  public async atomicReserveItem(
    productId: string,
    quantity: number
  ): Promise<{ success: boolean; available: number }> {
    const pool = await this.getPool();
    const res = await pool.query(
      `UPDATE inventory_stocks
       SET available_stock = available_stock - $1,
           reserved_stock = reserved_stock + $1,
           version = version + 1,
           updated_at = NOW()
       WHERE product_id = $2 AND available_stock >= $1
       RETURNING available_stock`,
      [quantity, productId]
    );

    if (res.rowCount === 0) {
      const current = await this.getStock(productId);
      return { success: false, available: current?.availableStock || 0 };
    }

    return { success: true, available: Number(res.rows[0].available_stock) };
  }

  public async atomicReleaseItem(
    productId: string,
    quantity: number
  ): Promise<{ success: boolean; available: number }> {
    const pool = await this.getPool();
    const res = await pool.query(
      `UPDATE inventory_stocks
       SET available_stock = available_stock + $1,
           reserved_stock = GREATEST(0, reserved_stock - $1),
           version = version + 1,
           updated_at = NOW()
       WHERE product_id = $2
       RETURNING available_stock`,
      [quantity, productId]
    );

    if (res.rowCount === 0) {
      const current = await this.getStock(productId);
      return { success: false, available: current?.availableStock || 0 };
    }

    return { success: true, available: Number(res.rows[0].available_stock) };
  }

  public async saveReservation(record: ReservationRecord): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO inventory_reservations (id, order_id, items, idempotency_key, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.orderId,
        JSON.stringify(record.items),
        record.idempotencyKey || null,
        record.status,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  public async getReservation(reservationId: string): Promise<ReservationRecord | null> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM inventory_reservations WHERE id = $1', [reservationId]);
    if (res.rows.length === 0) return null;
    return this.mapRowToReservation(res.rows[0]);
  }

  public async getReservationByOrderId(orderId: string): Promise<ReservationRecord | null> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM inventory_reservations WHERE order_id = $1 LIMIT 1', [orderId]);
    if (res.rows.length === 0) return null;
    return this.mapRowToReservation(res.rows[0]);
  }

  public async getReservationByIdempotencyKey(key: string): Promise<ReservationRecord | null> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT * FROM inventory_reservations WHERE idempotency_key = $1 LIMIT 1', [key]);
    if (res.rows.length === 0) return null;
    return this.mapRowToReservation(res.rows[0]);
  }

  private mapRowToReservation(r: any): ReservationRecord {
    const items: ReservationItem[] = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
    return {
      id: r.id,
      orderId: r.order_id,
      items,
      idempotencyKey: r.idempotency_key,
      status: r.status,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
