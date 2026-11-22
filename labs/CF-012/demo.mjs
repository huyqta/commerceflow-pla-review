// labs/CF-012/demo.mjs
// Micro-lab kiểm chứng thực chất cho CF-012:
// PostgreSQL, Prisma migrations và ACID Transactions trong Ordering Bounded Context.
// Chạy từ root: node labs/CF-012/demo.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 1. Kiểm tra sự tồn tại của các Artifacts cốt lõi
const schemaPath = path.resolve('apps/order-service/prisma/schema.prisma');
const migrationPath = path.resolve('apps/order-service/prisma/migrations/20261121000000_init_order_schema/migration.sql');
const rollbackPath = path.resolve('apps/order-service/prisma/migrations/rollback_plan.sql');

assert.ok(fs.existsSync(schemaPath), 'Lỗi: apps/order-service/prisma/schema.prisma không tồn tại!');
assert.ok(fs.existsSync(migrationPath), 'Lỗi: migration.sql không tồn tại!');
assert.ok(fs.existsSync(rollbackPath), 'Lỗi: rollback_plan.sql không tồn tại!');

// 2. Kiểm chứng đặc tả Prisma Schema
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

// A. Datasource & Generator
assert.match(schemaContent, /provider\s*=\s*"postgresql"/, 'Prisma phải cấu hình datasource PostgreSQL');
assert.match(schemaContent, /provider\s*=\s*"prisma-client-js"/, 'Prisma Client generator phải được kích hoạt');

// B. Models & Quan hệ 1-N giữa Order và OrderItem
assert.match(schemaContent, /model\s+Order\s+\{/, 'Thiếu model Order trong schema');
assert.match(schemaContent, /model\s+OrderItem\s+\{/, 'Thiếu model OrderItem trong schema');
assert.match(schemaContent, /model\s+OutboxEvent\s+\{/, 'Thiếu model OutboxEvent (Transactional Outbox)');

// C. Bảo vệ Invariant: Quan hệ Cascade Delete & Composite Unique Constraint
assert.match(
  schemaContent,
  /@relation\(fields:\s*\[orderId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
  'OrderItem phải tham chiếu Order với onDelete: Cascade'
);
assert.match(
  schemaContent,
  /@@unique\(\[orderId,\s*productId\]/,
  'Bắt buộc phải có composite unique constraint [orderId, productId] để chống trùng sản phẩm trong 1 đơn hàng'
);

// D. Hỗ trợ Idempotency Key (R-04) & Optimistic Concurrency Control (OCC)
assert.match(schemaContent, /idempotencyKey\s+String\?\s+@unique/, 'Thiếu @unique idempotencyKey để chống duplicate delivery');
assert.match(schemaContent, /version\s+Int\s+@default\(1\)/, 'Thiếu version để kiểm soát Optimistic Locking');

// 3. Kiểm chứng Migration SQL & DDL Constraints
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
assert.match(migrationSql, /CREATE TABLE "orders"/, 'Migration thiếu bảng orders');
assert.match(migrationSql, /CREATE TABLE "order_items"/, 'Migration thiếu bảng order_items');
assert.match(migrationSql, /CREATE TABLE "outbox_events"/, 'Migration thiếu bảng outbox_events');
assert.match(migrationSql, /CHECK \("quantity" > 0\)/, 'Migration thiếu CHECK constraint cho số lượng dương');
assert.match(migrationSql, /CHECK \("total_amount" >= 0\)/, 'Migration thiếu CHECK constraint cho tổng tiền');
assert.match(migrationSql, /CREATE UNIQUE INDEX "uq_order_items_order_product"/, 'Migration thiếu UNIQUE index order_product');

// 4. Kiểm chứng Kế hoạch Rollback (Down-migration)
const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');
const dropItemsIdx = rollbackSql.indexOf('DROP TABLE IF EXISTS "order_items"');
const dropOrdersIdx = rollbackSql.indexOf('DROP TABLE IF EXISTS "orders"');
assert.ok(dropItemsIdx < dropOrdersIdx, 'Thứ tự rollback phải xóa order_items trước orders để tránh lỗi Foreign Key');

// 5. Kiểm chứng tính chất ACID Transaction (Atomicity, Consistency, Rollback)
class InMemoryTxSimulator {
  constructor() {
    this.orders = new Map();
    this.orderItems = new Map();
    this.outbox = new Map();
    this.productIndex = new Set();
  }

  async executeTx(work) {
    const ordersSnap = new Map(this.orders);
    const itemsSnap = new Map(this.orderItems);
    const outboxSnap = new Map(this.outbox);
    const indexSnap = new Set(this.productIndex);

    const tx = {
      createOrder: (order) => {
        if (this.orders.has(order.id)) throw new Error('DUPLICATE_ORDER_ID');
        this.orders.set(order.id, order);
      },
      createOrderItem: (item) => {
        const key = `${item.orderId}:${item.productId}`;
        if (this.productIndex.has(key)) {
          throw new Error(`COMPOSITE_UNIQUE_VIOLATION: Product ${item.productId} đã tồn tại trong đơn ${item.orderId}`);
        }
        this.productIndex.add(key);
        this.orderItems.set(item.id, item);
      },
      createOutbox: (evt) => {
        this.outbox.set(evt.id, evt);
      },
    };

    try {
      await work(tx);
    } catch (err) {
      // Rollback
      this.orders = ordersSnap;
      this.orderItems = itemsSnap;
      this.outbox = outboxSnap;
      this.productIndex = indexSnap;
      throw err;
    }
  }
}

const sim = new InMemoryTxSimulator();

// Test case A: Transaction hoàn tất nguyên tử (Happy Path)
await sim.executeTx(async (tx) => {
  tx.createOrder({ id: 'ord-ok-1', customerId: 'c1', totalAmount: 300 });
  tx.createOrderItem({ id: 'it-1', orderId: 'ord-ok-1', productId: 'p1', quantity: 2 });
  tx.createOutbox({ id: 'evt-1', aggregateId: 'ord-ok-1', eventType: 'OrderCreatedDomainEvent' });
});
assert.equal(sim.orders.size, 1);
assert.equal(sim.orderItems.size, 1);
assert.equal(sim.outbox.size, 1);

// Test case B: Transaction Rollback khi vi phạm Unique Constraint
await assert.rejects(
  async () => {
    await sim.executeTx(async (tx) => {
      tx.createOrder({ id: 'ord-fail-1', customerId: 'c2', totalAmount: 500 });
      tx.createOrderItem({ id: 'it-2', orderId: 'ord-fail-1', productId: 'p2', quantity: 1 });
      // Cố tình chèn trùng productId trong cùng orderId
      tx.createOrderItem({ id: 'it-3', orderId: 'ord-fail-1', productId: 'p2', quantity: 1 });
    });
  },
  /COMPOSITE_UNIQUE_VIOLATION/
);

// Khẳng định Rollback: Không để lại rác trong database
assert.equal(sim.orders.size, 1, 'Rollback thành công: Không có thêm order rác');
assert.equal(sim.orderItems.size, 1, 'Rollback thành công: Không có order_item mồ côi');

console.log('MICRO_LAB_OK CF-012');
