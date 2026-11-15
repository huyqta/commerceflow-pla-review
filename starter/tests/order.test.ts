import assert from 'node:assert/strict';
import test from 'node:test';
import { Order } from '../src/domain/order.ts';

test('mới tạo đơn là PENDING', () => {
  const order = Order.create('order-001');
  assert.equal(order.getStatus(), 'PENDING');
});
test('không confirm đơn đã hủy', () => {
  const order = Order.create('order-002');
  order.cancel();
  assert.throws(() => order.confirm(), /INVALID_TRANSITION/);
});
test('không nhận id rỗng', () => {
  assert.throws(() => Order.create(' '), /ORDER_ID_REQUIRED/);
});
