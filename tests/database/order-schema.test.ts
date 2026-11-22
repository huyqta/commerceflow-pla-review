// tests/database/order-schema.test.ts
// Kiểm thử tự động đặc tả Prisma Schema, SQL Migrations, Check Constraints
// và cơ chế ACID Transaction / Transactional Outbox / Idempotency cho Order Service.
// Chạy trực tiếp qua: node --test tests/database/order-schema.test.ts

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe, it } from 'node:test';

describe('1. Đặc tả Prisma Schema & Kiến trúc cơ sở dữ liệu (PostgreSQL)', () => {
  const schemaPath = path.resolve('apps/order-service/prisma/schema.prisma');

  it('Tệp schema.prisma phải tồn tại tại apps/order-service/prisma/', () => {
    assert.ok(fs.existsSync(schemaPath), 'schema.prisma bắt buộc phải tồn tại');
  });

  it('Schema phải cấu hình đúng datasource PostgreSQL và client generator', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');
    assert.match(content, /provider\s*=\s*"postgresql"/, 'Datasource provider phải là postgresql');
    assert.match(content, /provider\s*=\s*"prisma-client-js"/, 'Generator provider phải là prisma-client-js');
  });

  it('Schema phải chứa đầy đủ các models: Order, OrderItem và OutboxEvent', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');
    assert.match(content, /model\s+Order\s+\{/, 'Bắt buộc phải có model Order');
    assert.match(content, /model\s+OrderItem\s+\{/, 'Bắt buộc phải có model OrderItem');
    assert.match(content, /model\s+OutboxEvent\s+\{/, 'Bắt buộc phải có model OutboxEvent');
  });

  it('Schema phải định nghĩa đầy đủ các Enums nghiệp vụ', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');
    assert.match(content, /enum\s+OrderStatus\s*\{[\s\S]*PENDING[\s\S]*CONFIRMED[\s\S]*CANCELLED[\s\S]*REJECTED[\s\S]*\}/);
    assert.match(content, /enum\s+OutboxStatus\s*\{[\s\S]*PENDING[\s\S]*PUBLISHED[\s\S]*FAILED[\s\S]*\}/);
  });

  it('Model OrderItem phải có quan hệ Cascade Delete với Order và Composite Unique Constraint (orderId, productId)', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');
    assert.match(content, /@relation\(fields:\s*\[orderId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/, 'OrderItem phải có quan hệ Cascade Delete với Order');
    assert.match(content, /@@unique\(\[orderId,\s*productId\]/, 'Bắt buộc phải có composite unique constraint [orderId, productId] chống trùng sản phẩm');
  });

  it('Model Order phải hỗ trợ Idempotency Key (@unique) và Optimistic Locking (version)', () => {
    const content = fs.readFileSync(schemaPath, 'utf8');
    assert.match(content, /idempotencyKey\s+String\?\s+@unique/, 'Order phải có idempotencyKey unique để bảo vệ kịch bản R-04');
    assert.match(content, /version\s+Int\s+@default\(1\)/, 'Order phải có trường version phục vụ Optimistic Concurrency Control');
  });
});

describe('2. SQL Migrations & Rollback Plan (Zero-Downtime Strategy)', () => {
  const migrationPath = path.resolve('apps/order-service/prisma/migrations/20261121000000_init_order_schema/migration.sql');
  const rollbackPath = path.resolve('apps/order-service/prisma/migrations/rollback_plan.sql');

  it('Migration SQL script phải tồn tại và chứa đầy đủ DDL tables & constraints', () => {
    assert.ok(fs.existsSync(migrationPath), 'Migration SQL script phải tồn tại');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.match(sql, /CREATE TABLE "orders"/, 'Phải có câu lệnh tạo bảng orders');
    assert.match(sql, /CREATE TABLE "order_items"/, 'Phải có câu lệnh tạo bảng order_items');
    assert.match(sql, /CREATE TABLE "outbox_events"/, 'Phải có câu lệnh tạo bảng outbox_events');
    assert.match(sql, /CONSTRAINT "chk_order_items_quantity_positive" CHECK \("quantity" > 0\)/, 'Phải có CHECK constraint quantity > 0');
    assert.match(sql, /CREATE UNIQUE INDEX "uq_order_items_order_product"/, 'Phải có unique index cho cặp (order_id, product_id)');
  });

  it('Kế hoạch Rollback (Down-migration) phải tồn tại và đảm bảo thứ tự xóa an toàn', () => {
    assert.ok(fs.existsSync(rollbackPath), 'Rollback plan phải tồn tại');
    const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');

    const itemDropIdx = rollbackSql.indexOf('DROP TABLE IF EXISTS "order_items"');
    const orderDropIdx = rollbackSql.indexOf('DROP TABLE IF EXISTS "orders"');
    assert.ok(itemDropIdx !== -1 && orderDropIdx !== -1, 'Phải drop order_items và orders');
    assert.ok(itemDropIdx < orderDropIdx, 'Phải xóa bảng con (order_items) trước bảng cha (orders) để tránh lỗi Foreign Key');
  });
});

describe('3. Mô phỏng ACID Database Transaction & Transactional Outbox', () => {
  // Bộ giả lập Database Transaction trong RAM để kiểm thử các tính chất ACID:
  // Atomicity (Nguyên tử), Consistency (Nhất quán), Isolation (Cô lập), Durability (Bền vững)
  class SimulatedDbTransaction {
    private orders = new Map<string, any>();
    private orderItems = new Map<string, any>();
    private outboxEvents = new Map<string, any>();
    private idempotencyKeys = new Set<string>();
    private productInOrderIndex = new Set<string>(); // composite unique (orderId + productId)

    // Thực thi transaction với rollback tự động nếu có lỗi
    public async runInTransaction<T>(
      action: (tx: SimulatedDbTransactionContext) => Promise<T>
    ): Promise<T> {
      // Snapshot state để rollback khi cần
      const ordersSnapshot = new Map(this.orders);
      const itemsSnapshot = new Map(this.orderItems);
      const outboxSnapshot = new Map(this.outboxEvents);
      const keysSnapshot = new Set(this.idempotencyKeys);
      const productIndexSnapshot = new Set(this.productInOrderIndex);

      const context: SimulatedDbTransactionContext = {
        insertOrder: (order) => {
          if (this.orders.has(order.id)) {
            throw new Error(`DB_UNIQUE_VIOLATION: Order with id '${order.id}' already exists`);
          }
          if (order.idempotencyKey) {
            if (this.idempotencyKeys.has(order.idempotencyKey)) {
              throw new Error(`DB_IDEMPOTENCY_VIOLATION: Order with idempotency key '${order.idempotencyKey}' already processed`);
            }
            this.idempotencyKeys.add(order.idempotencyKey);
          }
          if (order.totalAmount < 0) {
            throw new Error('DB_CHECK_VIOLATION: total_amount must be >= 0');
          }
          this.orders.set(order.id, { ...order, version: 1 });
        },
        insertOrderItem: (item) => {
          const compositeKey = `${item.orderId}#${item.productId}`;
          if (this.productInOrderIndex.has(compositeKey)) {
            throw new Error(`DB_COMPOSITE_UNIQUE_VIOLATION: Product '${item.productId}' already exists in order '${item.orderId}'`);
          }
          if (item.quantity <= 0) {
            throw new Error('DB_CHECK_VIOLATION: quantity must be > 0');
          }
          this.productInOrderIndex.add(compositeKey);
          this.orderItems.set(item.id, { ...item });
        },
        insertOutboxEvent: (event) => {
          this.outboxEvents.set(event.id, { ...event, status: 'PENDING', retryCount: 0 });
        },
        updateOrderVersion: (orderId, expectedVersion) => {
          const current = this.orders.get(orderId);
          if (!current) throw new Error('ORDER_NOT_FOUND');
          if (current.version !== expectedVersion) {
            throw new Error(`OCC_VERSION_CONFLICT: Expected version ${expectedVersion} but got ${current.version}`);
          }
          current.version += 1;
        },
      };

      try {
        const result = await action(context);
        return result; // Commit
      } catch (err) {
        // Rollback hoàn toàn về snapshot ban đầu
        this.orders = ordersSnapshot;
        this.orderItems = itemsSnapshot;
        this.outboxEvents = outboxSnapshot;
        this.idempotencyKeys = keysSnapshot;
        this.productInOrderIndex = productIndexSnapshot;
        throw err;
      }
    }

    public getOrderCount(): number {
      return this.orders.size;
    }

    public getOrderItemCount(): number {
      return this.orderItems.size;
    }

    public getOutboxCount(): number {
      return this.outboxEvents.size;
    }

    public getOrder(id: string): any {
      return this.orders.get(id);
    }
  }

  interface SimulatedDbTransactionContext {
    insertOrder(order: any): void;
    insertOrderItem(item: any): void;
    insertOutboxEvent(event: any): void;
    updateOrderVersion(orderId: string, expectedVersion: number): void;
  }

  it('Transaction thành công: Ghi đồng thời Order, OrderItems và OutboxEvent (Atomicity)', async () => {
    const db = new SimulatedDbTransaction();

    await db.runInTransaction(async (tx) => {
      tx.insertOrder({
        id: 'ord-tx-01',
        orderNumber: 'ORD-20261121-0001',
        customerId: 'cust-101',
        status: 'PENDING',
        totalAmount: 500,
        currency: 'VND',
        idempotencyKey: 'idem-tx-01',
      });

      tx.insertOrderItem({
        id: 'item-01',
        orderId: 'ord-tx-01',
        productId: 'prod-A',
        quantity: 2,
        unitPrice: 200,
        subtotal: 400,
      });

      tx.insertOrderItem({
        id: 'item-02',
        orderId: 'ord-tx-01',
        productId: 'prod-B',
        quantity: 1,
        unitPrice: 100,
        subtotal: 100,
      });

      tx.insertOutboxEvent({
        id: 'evt-01',
        aggregateType: 'Order',
        aggregateId: 'ord-tx-01',
        eventType: 'OrderCreatedDomainEvent',
        payload: { customerId: 'cust-101', totalAmount: 500 },
      });
    });

    assert.equal(db.getOrderCount(), 1);
    assert.equal(db.getOrderItemCount(), 2);
    assert.equal(db.getOutboxCount(), 1);
  });

  it('Transaction Rollback: Khi gặp lỗi trùng lặp Product trong Order, toàn bộ transaction bị hủy (0 orphan records)', async () => {
    const db = new SimulatedDbTransaction();

    await assert.rejects(
      async () => {
        await db.runInTransaction(async (tx) => {
          tx.insertOrder({
            id: 'ord-fail-tx',
            orderNumber: 'ORD-FAIL-01',
            customerId: 'cust-fail',
            status: 'PENDING',
            totalAmount: 300,
            currency: 'VND',
          });

          tx.insertOrderItem({
            id: 'item-fail-1',
            orderId: 'ord-fail-tx',
            productId: 'prod-DUPLICATE',
            quantity: 1,
            unitPrice: 150,
            subtotal: 150,
          });

          // Cố tình vi phạm Composite Unique Constraint [orderId, productId]
          tx.insertOrderItem({
            id: 'item-fail-2',
            orderId: 'ord-fail-tx',
            productId: 'prod-DUPLICATE',
            quantity: 1,
            unitPrice: 150,
            subtotal: 150,
          });
        });
      },
      /DB_COMPOSITE_UNIQUE_VIOLATION/
    );

    // Chứng minh Atomicity: Cả Order và các OrderItems trước đó đều bị xóa sạch (Rollback)
    assert.equal(db.getOrderCount(), 0, 'Bảng orders không được chứa bất kỳ bản ghi nào sau rollback');
    assert.equal(db.getOrderItemCount(), 0, 'Bảng order_items không được chứa dòng mồ côi (orphan records)');
    assert.equal(db.getOutboxCount(), 0, 'Outbox không được phát sinh sự kiện rác khi transaction thất bại');
  });

  it('Bảo vệ kịch bản R-04: Idempotency Key ngăn chặn việc lặp lại đơn hàng (Duplicate delivery)', async () => {
    const db = new SimulatedDbTransaction();

    // Lần 1: Thành công
    await db.runInTransaction(async (tx) => {
      tx.insertOrder({
        id: 'ord-idem-01',
        orderNumber: 'ORD-IDEM-1',
        customerId: 'cust-01',
        status: 'PENDING',
        totalAmount: 100,
        currency: 'VND',
        idempotencyKey: 'idem-key-duplicate-test',
      });
    });

    // Lần 2: Bị từ chối do trùng Idempotency Key
    await assert.rejects(
      async () => {
        await db.runInTransaction(async (tx) => {
          tx.insertOrder({
            id: 'ord-idem-02',
            orderNumber: 'ORD-IDEM-2',
            customerId: 'cust-01',
            status: 'PENDING',
            totalAmount: 100,
            currency: 'VND',
            idempotencyKey: 'idem-key-duplicate-test',
          });
        });
      },
      /DB_IDEMPOTENCY_VIOLATION/
    );

    assert.equal(db.getOrderCount(), 1, 'Chỉ 1 đơn hàng duy nhất được ghi nhận');
  });

  it('Optimistic Concurrency Control (OCC): Ngăn chặn ghi đè trạng thái mâu thuẫn khi phiên bản bị lệch', async () => {
    const db = new SimulatedDbTransaction();

    await db.runInTransaction(async (tx) => {
      tx.insertOrder({
        id: 'ord-occ-01',
        orderNumber: 'ORD-OCC-1',
        customerId: 'cust-01',
        status: 'PENDING',
        totalAmount: 200,
        currency: 'VND',
      });
    });

    // Transaction 1 cập nhật thành công (version 1 -> 2)
    await db.runInTransaction(async (tx) => {
      tx.updateOrderVersion('ord-occ-01', 1);
    });
    assert.equal(db.getOrder('ord-occ-01').version, 2);

    // Transaction 2 đến trễ cố cập nhật với version 1 -> Xung đột concurrency!
    await assert.rejects(
      async () => {
        await db.runInTransaction(async (tx) => {
          tx.updateOrderVersion('ord-occ-01', 1);
        });
      },
      /OCC_VERSION_CONFLICT/
    );
  });
});

