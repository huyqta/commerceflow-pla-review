// labs/CF-014/demo.mjs
// Micro-lab kiểm chứng thực chất cho CF-014:
// Inventory reservation, Atomic Conditional Update, Concurrency Race Conditions & Anti-Overselling
// Chạy từ root: node labs/CF-014/demo.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 1. Kiểm tra sự tồn tại của Artifact sản phẩm
const artifactPath = path.resolve('apps/inventory-service/src/application/reserve-stock.ts');
assert.ok(
  fs.existsSync(artifactPath),
  'Lỗi: apps/inventory-service/src/application/reserve-stock.ts không tồn tại!'
);

// 2. Dynamic import module reserve-stock.ts
const inventoryModule = await import(`file:///${artifactPath.replace(/\\/g, '/')}`);
const {
  ReserveStockUseCase,
  ReleaseStockUseCase,
  InMemoryInventoryRepository,
  InvalidQuantityError,
} = inventoryModule;

assert.ok(ReserveStockUseCase, 'Thiếu ReserveStockUseCase');
assert.ok(ReleaseStockUseCase, 'Thiếu ReleaseStockUseCase');
assert.ok(InMemoryInventoryRepository, 'Thiếu InMemoryInventoryRepository');

// 3. Kiểm chứng assertion gốc của Issue
let available = 1;
const reserve = (n) => {
  if (available < n) return false;
  available -= n;
  return true;
};
assert.equal(reserve(1), true, 'Lần 1: Giữ 1 thành công khi stock=1');
assert.equal(reserve(1), false, 'Lần 2: Giữ 1 thất bại khi stock=0');

// 4. Kiểm chứng Kịch bản R-01 (Happy Path) & R-02 (Out of stock)
const repo = new InMemoryInventoryRepository([
  { productId: 'ITEM-A', availableStock: 5, reservedStock: 0, totalStock: 5, version: 1 },
  { productId: 'ITEM-B', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
]);
const reserveUseCase = new ReserveStockUseCase(repo);
const releaseUseCase = new ReleaseStockUseCase(repo);

// R-01: Đặt 2 trên stock 5
const resR01 = await reserveUseCase.execute({
  orderId: 'ord-demo-01',
  items: [{ productId: 'ITEM-A', quantity: 2 }],
});
assert.equal(resR01.success, true);
let stockA = await repo.getStock('ITEM-A');
assert.equal(stockA?.availableStock, 3);
assert.equal(stockA?.reservedStock, 2);

// R-02: Đặt 2 trên stock 1 -> Từ chối, không âm kho
const resR02 = await reserveUseCase.execute({
  orderId: 'ord-demo-02',
  items: [{ productId: 'ITEM-B', quantity: 2 }],
});
assert.equal(resR02.success, false);
assert.equal(resR02.reason, 'OUT_OF_STOCK');
let stockB = await repo.getStock('ITEM-B');
assert.equal(stockB?.availableStock, 1);

// 5. Kiểm chứng Kịch bản R-03: Saga Compensation & Chống Double Compensation
const releaseRes = await releaseUseCase.execute({
  reservationId: resR01.reservationId,
  orderId: 'ord-demo-01',
});
assert.equal(releaseRes.success, true);
assert.equal(releaseRes.released, true);
stockA = await repo.getStock('ITEM-A');
assert.equal(stockA?.availableStock, 5, 'Tồn kho được hoàn trả về 5');

// Gọi lặp lại release -> Không cộng dồn tồn kho
const doubleReleaseRes = await releaseUseCase.execute({
  reservationId: resR01.reservationId,
  orderId: 'ord-demo-01',
});
assert.equal(doubleReleaseRes.released, false);
assert.equal(doubleReleaseRes.reason, 'ALREADY_RELEASED');
stockA = await repo.getStock('ITEM-A');
assert.equal(stockA?.availableStock, 5, 'Tồn kho vẫn là 5, không bị tăng ảo thành 7');

// 6. Kiểm chứng Thử thách Độc lập: Concurrency Race Condition Test (2 đơn cùng tranh món cuối)
const raceRepo = new InMemoryInventoryRepository([
  { productId: 'LAST-PHONE', availableStock: 1, reservedStock: 0, totalStock: 1, version: 1 },
]);
const raceUseCase = new ReserveStockUseCase(raceRepo);

const [order1, order2] = await Promise.all([
  raceUseCase.execute({ orderId: 'ord-race-1', items: [{ productId: 'LAST-PHONE', quantity: 1 }] }),
  raceUseCase.execute({ orderId: 'ord-race-2', items: [{ productId: 'LAST-PHONE', quantity: 1 }] }),
]);

const wins = [order1, order2].filter((r) => r.success);
const losses = [order1, order2].filter((r) => !r.success);
assert.equal(wins.length, 1, 'Chính xác 1 đơn giữ hàng thành công');
assert.equal(losses.length, 1, 'Đơn còn lại bị từ chối do hết hàng');

const finalStock = await raceRepo.getStock('LAST-PHONE');
assert.equal(finalStock?.availableStock, 0, 'Tồn khả dụng đúng bằng 0, không bị âm');
assert.equal(finalStock?.reservedStock, 1);

console.log('MICRO_LAB_OK CF-014');
