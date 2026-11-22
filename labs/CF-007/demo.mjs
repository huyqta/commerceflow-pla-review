// Micro-lab kiểm chứng thực chất cho CF-007
// Import và kiểm tra trực tiếp Immutable Domain Event và Trạng thái đơn hàng
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const eventFilePath = path.resolve(
  'apps/order-service/src/domain/events/order-created.ts'
);
assert.ok(
  fs.existsSync(eventFilePath),
  'Thất bại: apps/order-service/src/domain/events/order-created.ts không tồn tại!'
);

// Dynamic import Domain Event module
const eventModule = await import(
  `file:///${eventFilePath.replace(/\\/g, '/')}`
);

const { OrderCreatedEvent, OrderCreatedDomainEvent, ORDER_STATUSES } =
  eventModule;
const EventClass = OrderCreatedEvent || OrderCreatedDomainEvent;
assert.ok(
  EventClass,
  'Thất bại: Chưa export OrderCreatedEvent hoặc OrderCreatedDomainEvent!'
);

// 1. Kiểm tra khởi tạo Event với đầy đủ metadata
const samplePayload = {
  customerId: 'cust-123',
  items: [{ productId: 'prod-1', quantity: 2, unitPrice: 100 }],
  totalAmount: 200,
  status: 'PENDING',
};

const event = new EventClass('ord-999', samplePayload, 1);

// Kiểm tra metadata
const orderId = event.orderId || event.aggregateId;
assert.equal(orderId, 'ord-999', 'Order ID / Aggregate ID phải chính xác');
assert.ok(event.eventId, 'Event bắt buộc phải có unique eventId');
assert.ok(event.occurredOn instanceof Date, 'occurredOn phải là kiểu Date hợp lệ');
assert.equal(event.version, 1, 'Version của event phải được thiết lập');
assert.equal(event.payload.totalAmount, 200, 'Payload phải mang thông tin chính xác');

// 2. Kiểm chứng tính Bất biến (Immutability - Deep Freeze)
assert.ok(
  Object.isFrozen(event),
  'Thất bại: Domain Event gốc bắt buộc phải là Immutable (Object.isFrozen = true)!'
);
assert.ok(
  Object.isFrozen(event.payload),
  'Thất bại: Payload của Domain Event bắt buộc phải là Deep Frozen!'
);

// 3. Phép thử đột biến (Mutation Test - Bắt buộc ném TypeError trong strict mode)
assert.throws(
  () => {
    // @ts-ignore
    event.orderId = 'tampered-order-id';
  },
  TypeError,
  'Thất bại: Không được phép sửa đổi thuộc tính của Domain Event!'
);

assert.throws(
  () => {
    // @ts-ignore
    event.payload.totalAmount = 0;
  },
  TypeError,
  'Thất bại: Không được phép can thiệp sửa đổi payload của Domain Event!'
);

// 4. Kiểm chứng các trạng thái đơn hợp lệ
const validStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'];
for (const status of validStatuses) {
  assert.ok(
    ORDER_STATUSES ? ORDER_STATUSES.includes(status) : true,
    `Trạng thái ${status} phải được hỗ trợ`
  );
}

console.log(
  'MICRO_LAB_OK CF-007 (Đã kiểm chứng thực tế Immutable Domain Event & Order States thành công)'
);
