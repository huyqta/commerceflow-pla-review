// Micro-lab kiểm chứng thực chất cho CF-010
// Import và kiểm tra trực tiếp Domain Tests & Architecture Boundary
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const testFilePath = path.resolve('tests/architecture/order-boundary.test.ts');
assert.ok(
  fs.existsSync(testFilePath),
  'Thất bại: tests/architecture/order-boundary.test.ts không tồn tại!'
);

// 1. Kiểm tra quy tắc phụ thuộc kiến trúc: Domain không import ORM hoặc Framework
const domainDir = path.resolve('apps/order-service/src/domain');
const appDir = path.resolve('apps/order-service/src/application');

function scanFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...scanFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const domainFiles = scanFiles(domainDir);
assert.ok(domainFiles.length >= 2, 'Domain phải có ít nhất order.aggregate.ts và order-created.ts');

for (const file of domainFiles) {
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(!code.includes('@prisma/client'), `Domain file ${file} không được import @prisma/client`);
  assert.ok(!code.includes("'prisma'"), `Domain file ${file} không được import prisma`);
  assert.ok(!code.includes('@nestjs'), `Domain file ${file} không được import @nestjs`);
}

const appFiles = scanFiles(appDir);
for (const file of appFiles) {
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(!code.includes('@prisma/client'), `Application file ${file} không được import @prisma/client`);
}

// 2. Dynamic import Domain & Application modules để kiểm chứng Invariants
const domainPath = path.resolve('apps/order-service/src/domain/order.aggregate.ts');
const { Order, Quantity, Money } = await import(`file:///${domainPath.replace(/\\/g, '/')}`);

// Invariant Quantity
assert.throws(() => new Quantity(0), /QUANTITY_MUST_BE_POSITIVE/);
assert.throws(() => new Quantity(-2), /QUANTITY_MUST_BE_POSITIVE/);

// Invariant Money
assert.throws(() => new Money(-50), /INVALID_MONEY_AMOUNT/);

// Invariant chống trùng lặp Product ID trong cùng một đơn hàng
assert.throws(
  () =>
    Order.create('ord-test-dup', 'c1', [
      { productId: 'prod-X', quantity: 1, unitPrice: 100 },
      { productId: 'prod-X', quantity: 2, unitPrice: 100 },
    ]),
  /DUPLICATE_ORDER_ITEM/,
  'Order.create phải từ chối khi phát hiện trùng lặp productId'
);

// Invariant chuyển đổi trạng thái
const order = Order.create('ord-status-test', 'c1', [{ productId: 'p1', quantity: 1, unitPrice: 100 }]);
order.cancel();
assert.throws(() => order.confirm(), /INVALID_TRANSITION/);

console.log(
  'MICRO_LAB_OK CF-010 (Đã kiểm chứng thực tế Domain tests & Architecture Boundary thành công)'
);
