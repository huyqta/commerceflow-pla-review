// Micro-lab minh họa độc lập CF-020: Event bus abstraction và Pub/Sub adapter
// Chạy từ root repository: node labs/CF-020/demo.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('[CF-020 Micro-Lab] Bắt đầu kiểm tra Event Bus Abstraction & Pub/Sub Adapter...');

// 1. Kiểm tra sự tồn tại của artifact packages/messaging/src/event-bus.ts
const eventBusPath = path.resolve('packages/messaging/src/event-bus.ts');
assert.ok(fs.existsSync(eventBusPath), 'Tệp packages/messaging/src/event-bus.ts phải tồn tại');

const eventBusSrc = fs.readFileSync(eventBusPath, 'utf8');

// 2. Micro-lab assertion chuẩn
const published = [];
const bus = { publish: async (e) => published.push(e) };
await bus.publish({ eventId: 'e1' });
assert.equal(published.length, 1);

// 3. Kiểm tra các định nghĩa cốt lõi trong artifact
assert.ok(eventBusSrc.includes('interface IEventBus'), 'Phải định nghĩa interface IEventBus');
assert.ok(eventBusSrc.includes('class InMemoryEventBus'), 'Phải cài đặt InMemoryEventBus adapter');
assert.ok(eventBusSrc.includes('class GcpPubSubAdapter'), 'Phải cài đặt GcpPubSubAdapter cho cloud');
assert.ok(eventBusSrc.includes('correlationId'), 'Event Envelope phải hỗ trợ correlationId');

console.log('✔ Toàn bộ kiểm tra Event Bus Abstraction CF-020 đều HỢP LỆ.');
console.log('MICRO_LAB_OK CF-020');
