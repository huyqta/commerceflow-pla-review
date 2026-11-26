// apps/order-service/src/infrastructure/postgres-order.repository.ts
// PostgreSQL Adapter cho Ordering Bounded Context (order_db)
// Triển khai OrderRepository Port với ACID Transactions, Outbox và Persistence Reconstitution

import { Order } from '../domain/order.aggregate.ts';
import type { OrderStatus } from '../domain/order.aggregate.ts';
import type { OrderRepository } from '../application/ports/order-repository.ts';

export class PostgresOrderRepository implements OrderRepository {
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
        console.warn('[PostgresOrderRepository] pg driver not available, cannot connect:', err);
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
        DO $$ BEGIN
          CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REJECTED');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;

        DO $$ BEGIN
          CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;

        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          order_number TEXT UNIQUE NOT NULL,
          customer_id TEXT NOT NULL,
          status "OrderStatus" NOT NULL DEFAULT 'PENDING',
          total_amount DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
          currency VARCHAR(10) NOT NULL DEFAULT 'VND',
          version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          idempotency_key TEXT UNIQUE,
          correlation_id TEXT,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL,
          product_name TEXT,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_price DECIMAL(12,2) NOT NULL CHECK (unit_price >= 0),
          subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (order_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS outbox_events (
          id TEXT PRIMARY KEY,
          aggregate_type TEXT NOT NULL DEFAULT 'Order',
          aggregate_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload JSONB NOT NULL,
          correlation_id TEXT,
          status "OutboxStatus" NOT NULL DEFAULT 'PENDING',
          published_at TIMESTAMP(3),
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.isInitialized = true;
      console.log('[PostgresOrderRepository] Schema initialized successfully in order_db');
    } catch (err) {
      console.error('[PostgresOrderRepository] Error initializing schema:', err);
      throw err;
    }
  }

  public async save(order: Order): Promise<void> {
    const pool = await this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const items = order.getItems();
      const totalAmount = order.getTotalAmount();
      const orderNumber = `ORD-${order.id}`;

      // 1. Upsert Order
      await client.query(
        `INSERT INTO orders (id, order_number, customer_id, status, total_amount, currency, version, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'VND', 1, NOW())
         ON CONFLICT (id) DO UPDATE
         SET status = EXCLUDED.status,
             total_amount = EXCLUDED.total_amount,
             updated_at = NOW()`,
        [order.id, orderNumber, order.customerId, order.getStatus(), totalAmount]
      );

      // 2. Upsert Order Items
      for (const item of items) {
        const itemId = `${order.id}-${item.productId}`;
        const qty = typeof (item.quantity as any)?.value === 'number'
          ? (item.quantity as any).value
          : Number(item.quantity) || 1;
        const price = typeof (item.unitPrice as any)?.amount === 'number'
          ? (item.unitPrice as any).amount
          : Number(item.unitPrice) || 0;
        const subtotal = qty * price;

        await client.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (order_id, product_id) DO UPDATE
           SET quantity = EXCLUDED.quantity,
               unit_price = EXCLUDED.unit_price,
               subtotal = EXCLUDED.subtotal`,
          [itemId, order.id, item.productId, qty, price, subtotal]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async findById(id: string): Promise<Order | null> {
    const pool = await this.getPool();
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) return null;

    const row = orderRes.rows[0];
    const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]);

    const itemInputs = itemsRes.rows.map((it: any) => ({
      productId: it.product_id,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      currency: 'VND',
    }));

    return Order.reconstitute(
      row.id,
      row.customer_id,
      itemInputs,
      row.status as OrderStatus,
      new Date(row.created_at),
      new Date(row.updated_at)
    );
  }

  public async findByCustomerId(customerId: string): Promise<Order[]> {
    const pool = await this.getPool();
    const orderRes = await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [customerId]);
    const orders: Order[] = [];

    for (const row of orderRes.rows) {
      const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [row.id]);
      const itemInputs = itemsRes.rows.map((it: any) => ({
        productId: it.product_id,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
        currency: 'VND',
      }));
      orders.push(
        Order.reconstitute(
          row.id,
          row.customer_id,
          itemInputs,
          row.status as OrderStatus,
          new Date(row.created_at),
          new Date(row.updated_at)
        )
      );
    }
    return orders;
  }

  public async findAll(): Promise<Order[]> {
    const pool = await this.getPool();
    const orderRes = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    const orders: Order[] = [];

    for (const row of orderRes.rows) {
      const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [row.id]);
      const itemInputs = itemsRes.rows.map((it: any) => ({
        productId: it.product_id,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
        currency: 'VND',
      }));
      orders.push(
        Order.reconstitute(
          row.id,
          row.customer_id,
          itemInputs,
          row.status as OrderStatus,
          new Date(row.created_at),
          new Date(row.updated_at)
        )
      );
    }
    return orders;
  }

  public async exists(id: string): Promise<boolean> {
    const pool = await this.getPool();
    const res = await pool.query('SELECT 1 FROM orders WHERE id = $1 LIMIT 1', [id]);
    return res.rows.length > 0;
  }

  public async delete(id: string): Promise<boolean> {
    const pool = await this.getPool();
    const res = await pool.query('DELETE FROM orders WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
