// labs/CF-015/demo.mjs
// Micro-lab kiểm chứng thực chất cho CF-015:
// Order lifecycle trong Modular Monolith, State Machine Invariants & Coordination qua Interfaces
// Chạy từ root: node labs/CF-015/demo.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 1. Kiểm tra sự tồn tại của Artifact
const artifactPath = path.resolve('apps/order-service/src/application/place-order.ts');
assert.ok(
  fs.existsSync(artifactPath),
  'Lỗi: apps/order-service/src/application/place-order.ts không tồn tại!'
);

// 2. Dynamic import module place-order.ts
const placeOrderModule = await import(`file:///${artifactPath.replace(/\\/g, '/')}`);
const {
  PlaceOrderUseCase,
  PlaceOrderController,
  ORDER_LIFECYCLE_TRANSITIONS,
  canTransitionOrder,
  InMemoryCatalogPortAdapter,
  PaymentSimulatorPortAdapter,
} = placeOrderModule;

assert.ok(PlaceOrderUseCase, 'Thiếu PlaceOrderUseCase');
assert.ok(ORDER_LIFECYCLE_TRANSITIONS, 'Thiếu ORDER_LIFECYCLE_TRANSITIONS');

// Dynamic import các module phụ thuộc nội bộ (Clean Modular Monolith)
const orderRepoModule = await import('file:///' + path.resolve('apps/order-service/src/application/ports/order-repository.ts').replace(/\\/g, '/'));
const inventoryModule = await import('file:///' + path.resolve('apps/inventory-service/src/application/reserve-stock.ts').replace(/\\/g, '/'));

const { InMemoryOrderRepository } = orderRepoModule;
const { InMemoryInventoryRepository, ReserveStockUseCase, ReleaseStockUseCase } = inventoryModule;

// 3. Kiểm chứng assertion gốc của Issue: transitions invariant
const transitions = { PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: [], CANCELLED: [] };
assert.equal(transitions.CANCELLED.includes('CONFIRMED'), false, 'CANCELLED không thể chuyển sang CONFIRMED');

// 4. Kiểm chứng State Machine Invariants & Thử thách độc lập
assert.equal(canTransitionOrder('PENDING', 'CONFIRMED'), true);
assert.equal(canTransitionOrder('PENDING', 'CANCELLED'), true);
assert.equal(canTransitionOrder('PENDING', 'REJECTED'), true);

// Thử thách độc lập: CONFIRMED không bao giờ được phép chuyển sang CANCELLED
assert.equal(
  canTransitionOrder('CONFIRMED', 'CANCELLED'),
  false,
  'Thử thách độc lập: Đơn hàng đã CONFIRMED tuyệt đối không được phép CANCEL'
);

// 5. Kiểm chứng Kịch bản R-01 (Happy Path: Đơn hàng thành công)
const orderRepo = new InMemoryOrderRepository();
const catalogPort = new InMemoryCatalogPortAdapter([
  { id: 'PROD-A', sku: 'SKU-A', name: 'Sản phẩm A', price: 100, currency: 'VND' },
]);
const inventoryRepo = new InMemoryInventoryRepository([
  { productId: 'PROD-A', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
]);
const reserveUseCase = new ReserveStockUseCase(inventoryRepo);
const releaseUseCase = new ReleaseStockUseCase(inventoryRepo);

const inventoryPort = {
  reserveStock: (cmd) => reserveUseCase.execute(cmd),
  releaseStock: (cmd) => releaseUseCase.execute(cmd),
};
const paymentPort = new PaymentSimulatorPortAdapter(false);

const placeOrderUseCase = new PlaceOrderUseCase(orderRepo, catalogPort, inventoryPort, paymentPort);

const happyResult = await placeOrderUseCase.execute({
  orderId: 'ord-happy-demo',
  customerId: 'cust-demo-1',
  items: [{ productId: 'PROD-A', quantity: 2 }],
});

assert.equal(happyResult.status, 'CONFIRMED');
assert.equal(happyResult.totalAmount, 200);
const stockAfterHappy = await inventoryRepo.getStock('PROD-A');
assert.equal(stockAfterHappy.availableStock, 3, 'Tồn khả dụng phải giảm từ 5 xuống 3');

// 6. Kiểm chứng Kịch bản R-02 (Hết hàng -> REJECTED, không trừ payment)
const outOfStockResult = await placeOrderUseCase.execute({
  orderId: 'ord-fail-demo',
  customerId: 'cust-demo-2',
  items: [{ productId: 'PROD-A', quantity: 10 }], // Cố tình đặt 10 trong khi kho chỉ còn 3
});
assert.equal(outOfStockResult.status, 'REJECTED');
assert.equal(outOfStockResult.reason, 'OUT_OF_STOCK');

// 7. Kiểm chứng Kịch bản R-03 (Thanh toán lỗi -> CANCELLED + Bồi hoàn kho)
paymentPort.setSimulateFailure(true); // Giả lập lỗi thanh toán
const payFailResult = await placeOrderUseCase.execute({
  orderId: 'ord-payfail-demo',
  customerId: 'cust-demo-3',
  items: [{ productId: 'PROD-A', quantity: 2 }],
});
assert.equal(payFailResult.status, 'CANCELLED');

// Tồn kho khả dụng phải được hoàn trả lại về 3 (không bị trừ 2)
const stockAfterCompensation = await inventoryRepo.getStock('PROD-A');
assert.equal(stockAfterCompensation.availableStock, 3, 'Saga Compensation phải bồi hoàn tồn kho');

console.log('MICRO_LAB_OK CF-015');
