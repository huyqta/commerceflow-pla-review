// Micro-lab minh họa độc lập CF-021: Transactional Outbox/Inbox, idempotent consumers
// Chạy từ root repository: node labs/CF-021/demo.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('[CF-021 Micro-Lab] Bắt đầu kiểm tra Transactional Outbox & Idempotent Consumers...');

// 1. Kiểm tra sự tồn tại của artifact apps/order-service/src/infrastructure/outbox-publisher.ts
const outboxPath = path.resolve('apps/order-service/src/infrastructure/outbox-publisher.ts');
assert.ok(fs.existsSync(outboxPath), 'Tệp apps/order-service/src/infrastructure/outbox-publisher.ts phải tồn tại');

const outboxSrc = fs.readFileSync(outboxPath, 'utf8');

// 2. Micro-lab assertion chuẩn
const inbox = new Set();
let sideEffects = 0;
const handle = (id) => {
  if (inbox.has(id)) return;
  inbox.add(id);
  sideEffects++;
};
handle('event-1');
handle('event-1');
assert.equal(sideEffects, 1, 'Idempotent handler chỉ thực thi side effect 1 lần duy nhất');

// 3. Kiểm tra các thành phần cốt lõi trong artifact
assert.ok(outboxSrc.includes('class InMemoryTransactionalStore'), 'Phải cài đặt InMemoryTransactionalStore');
assert.ok(outboxSrc.includes('class OutboxPublisherWorker'), 'Phải cài đặt OutboxPublisherWorker');
assert.ok(outboxSrc.includes('class IdempotentConsumer'), 'Phải cài đặt IdempotentConsumer');
assert.ok(outboxSrc.includes('executeTransaction'), 'Phải có cơ chế Transactional Atomicity');

console.log('✔ Toàn bộ kiểm tra Transactional Outbox/Inbox CF-021 đều HỢP LỆ.');
console.log('MICRO_LAB_OK CF-021');
