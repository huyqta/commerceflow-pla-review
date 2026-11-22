// Micro-lab kiểm chứng thực chất cho CF-006
// Import và kiểm tra trực tiếp Order Aggregate, Value Objects và Business Invariants
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const aggregatePath = path.resolve('apps/order-service/src/domain/order.aggregate.ts');
assert.ok(
  fs.existsSync(aggregatePath),
  'Thất bại: apps/order-service/src/domain/order.aggregate.ts không tồn tại!'
);

// Dynamic import Order Aggregate
const { Order, Quantity, Money, OrderLineItem } = await import(
  `file:///${aggregatePath.replace(/\\/g, '/')}`
);

// 1. Kiểm chứng Invariant của Quantity Value Object
assert.ok(Quantity, 'Thất bại: Chưa export class Quantity!');
assert.throws(
  () => new Quantity(0),
  /INVALID_QUANTITY|QUANTITY_MUST_BE_POSITIVE/,
  'Thất bại: Quantity phải ném lỗi khi giá trị <= 0!'
);
assert.throws(
  () => new Quantity(-3),
  /INVALID_QUANTITY|QUANTITY_MUST_BE_POSITIVE/,
  'Thất bại: Quantity phải ném lỗi khi giá trị âm!'
);
assert.throws(
  () => new Quantity(1.5),
  /INVALID_QUANTITY|QUANTITY_MUST_BE_INTEGER/,
  'Thất bại: Quantity phải ném lỗi khi không phải số nguyên!'
);
assert.equal(new Quantity(5).value, 5, 'Quantity khởi tạo hợp lệ');

// 2. Kiểm chứng Invariant khi tạo Order
assert.ok(Order, 'Thất bại: Chưa export class Order!');
assert.throws(
  () => Order.create('', 'cust-1', [{ productId: 'prod-1', quantity: 2, unitPrice: 100 }]),
  /ORDER_ID_REQUIRED/,
  'Thất bại: Order.create phải ném lỗi ORDER_ID_REQUIRED khi id rỗng!'
);
assert.throws(
  () => Order.create('ord-1', 'cust-1', []),
  /EMPTY_ORDER_ITEMS/,
  'Thất bại: Order.create phải ném lỗi EMPTY_ORDER_ITEMS khi danh sách mặt hàng rỗng!'
);

// 3. Kiểm chứng tạo đơn hợp lệ (Happy Path)
const validItems = [
  { productId: 'prod-A', quantity: 2, unitPrice: 100 },
  { productId: 'prod-B', quantity: 3, unitPrice: 200 },
];
const order = Order.create('ord-001', 'cust-001', validItems);
assert.equal(order.getStatus(), 'PENDING', 'Trạng thái ban đầu phải là PENDING');
assert.equal(order.getTotalAmount(), 800, 'Tổng tiền phải tính chính xác (2*100 + 3*200 = 800)');
assert.ok(
  order.getDomainEvents().some((e) => e.eventName === 'OrderCreatedDomainEvent'),
  'Phải sinh ra OrderCreatedDomainEvent khi tạo đơn'
);

// 4. Kiểm chứng Invariant: Không cho confirm đơn đã hủy (CANCELLED -> CONFIRMED bị cấm)
const cancelOrder = Order.create('ord-002', 'cust-001', validItems);
cancelOrder.cancel('Khách hàng đổi ý');
assert.equal(cancelOrder.getStatus(), 'CANCELLED');
assert.throws(
  () => cancelOrder.confirm(),
  /INVALID_TRANSITION|CANNOT_CONFIRM_CANCELLED_ORDER/,
  'Thất bại: Tuyệt đối không được phép confirm đơn hàng đã bị CANCELLED!'
);

// 5. Kiểm chứng Invariant: Không cho cancel đơn đã hoàn thành (CONFIRMED -> CANCELLED bị cấm)
const confirmOrder = Order.create('ord-003', 'cust-001', validItems);
confirmOrder.confirm();
assert.equal(confirmOrder.getStatus(), 'CONFIRMED');
assert.throws(
  () => confirmOrder.cancel('Muốn hủy đơn đã xác nhận'),
  /INVALID_TRANSITION|CANNOT_CANCEL_CONFIRMED_ORDER/,
  'Thất bại: Tuyệt đối không được phép cancel đơn hàng đã CONFIRMED!'
);

console.log(
  'MICRO_LAB_OK CF-006 (Đã kiểm chứng thực tế Order Aggregate & Business Invariants thành công)'
);
