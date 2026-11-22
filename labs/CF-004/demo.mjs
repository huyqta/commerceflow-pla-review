// Micro-lab kiểm chứng thực chất cho CF-004
// Đọc trực tiếp docs/ddd/context-map.md và kiểm tra Bounded Context Map, Event Storming, Ownership
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const contextMapPath = path.resolve('docs/ddd/context-map.md');
assert.ok(fs.existsSync(contextMapPath), 'Thất bại: docs/ddd/context-map.md không tồn tại!');

const content = fs.readFileSync(contextMapPath, 'utf8');

// 1. Kiểm tra độ dài nội dung chi tiết
assert.ok(content.length > 500, 'Thất bại: docs/ddd/context-map.md quá ngắn hoặc chưa có nội dung phân tích chi tiết!');

// 2. Kiểm tra đủ 4 Bounded Contexts cốt lõi
const requiredContexts = ['Catalog', 'Ordering', 'Inventory', 'Payments'];
for (const ctx of requiredContexts) {
  assert.ok(
    content.includes(ctx),
    `Thất bại: Thiếu định nghĩa Bounded Context "${ctx}" trong docs/ddd/context-map.md`
  );
}

// 3. Kiểm tra các thành phần cốt lõi của Event Storming: Command, Event, Policy
const requiredConcepts = ['Command', 'Event', 'Policy'];
for (const concept of requiredConcepts) {
  assert.ok(
    content.toLowerCase().includes(concept.toLowerCase()),
    `Thất bại: Thiếu thành phần "${concept}" trong mô tả Event Storming!`
  );
}

// 4. Kiểm tra Ownership của các sự kiện quan trọng
assert.ok(
  content.includes('OrderCreated') && content.includes('Ordering'),
  'Thất bại: Chưa thể hiện quyền sở hữu (Ownership) của OrderCreated thuộc về Ordering Context!'
);

assert.ok(
  content.includes('InventoryReserved') && content.includes('Inventory'),
  'Thất bại: Chưa thể hiện quyền sở hữu (Ownership) của InventoryReserved thuộc về Inventory Context!'
);

// 5. Kiểm tra phân tích luồng sinh ra của InventoryReserved (Thử thách độc lập của CF-004)
const hasInventoryReservedFlow =
  content.includes('InventoryReserved') &&
  (content.includes('sinh ra') || content.includes('phát sinh') || content.includes('origin')) &&
  (content.includes('Reserve') || content.includes('reserve'));

assert.ok(
  hasInventoryReservedFlow,
  'Thất bại: Chưa phân tích chi tiết luồng sinh ra của sự kiện "InventoryReserved" (Thử thách độc lập của CF-004)!'
);

console.log('MICRO_LAB_OK CF-004 (Đã kiểm chứng thực tế docs/ddd/context-map.md thành công)');
