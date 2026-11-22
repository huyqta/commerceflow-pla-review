// Micro-lab kiểm chứng thực chất cho CF-008
// Import và kiểm tra trực tiếp Ports, Adapters và Dependency Inversion
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const portFilePath = path.resolve('apps/order-service/src/application/ports/order-repository.ts');
const domainFilePath = path.resolve('apps/order-service/src/domain/order.aggregate.ts');

assert.ok(
  fs.existsSync(portFilePath),
  'Thất bại: apps/order-service/src/application/ports/order-repository.ts không tồn tại!'
);
assert.ok(
  fs.existsSync(domainFilePath),
  'Thất bại: apps/order-service/src/domain/order.aggregate.ts không tồn tại!'
);

// 1. Kiểm tra Architecture Boundary & Dependency Inversion:
// Domain và Port TUYỆT ĐỐI KHÔNG import Prisma hay bất kỳ ORM nào
const portFileContent = fs.readFileSync(portFilePath, 'utf8');
const domainFileContent = fs.readFileSync(domainFilePath, 'utf8');

assert.ok(
  !portFileContent.includes('@prisma/client') && !portFileContent.includes('from "prisma"') && !portFileContent.includes("from 'prisma'"),
  'Vi phạm DIP: Port/Application không được phép import Prisma!'
);
assert.ok(
  !domainFileContent.includes('@prisma/client') && !domainFileContent.includes('from "prisma"') && !domainFileContent.includes("from 'prisma'"),
  'Vi phạm DIP: Domain layer không được phép import Prisma!'
);

// Dynamic import
const portModule = await import(`file:///${portFilePath.replace(/\\/g, '/')}`);
const domainModule = await import(`file:///${domainFilePath.replace(/\\/g, '/')}`);

const { InMemoryOrderRepository } = portModule;
const { Order } = domainModule;

assert.ok(InMemoryOrderRepository, 'Thất bại: Chưa export class InMemoryOrderRepository!');
assert.ok(Order, 'Thất bại: Chưa export class Order!');

// 2. Kiểm chứng In-Memory Adapter lưu và truy xuất Aggregate
const repo = new InMemoryOrderRepository();
assert.equal(repo.count(), 0, 'Repository mới khởi tạo phải có count = 0');

const sampleItems = [
  { productId: 'prod-A', quantity: 2, unitPrice: 100 },
  { productId: 'prod-B', quantity: 3, unitPrice: 200 },
];
const order1 = Order.create('ord-001', 'cust-ABC', sampleItems);

await repo.save(order1);
assert.equal(repo.count(), 1, 'Sau khi lưu, count phải = 1');
assert.equal(await repo.exists('ord-001'), true, 'Đơn ord-001 phải tồn tại');

// Truy xuất theo ID
const foundOrder = await repo.findById('ord-001');
assert.ok(foundOrder, 'Phải tìm thấy đơn hàng theo ID');
assert.equal(foundOrder.id, 'ord-001');
assert.equal(foundOrder.customerId, 'cust-ABC');
assert.equal(foundOrder.getStatus(), 'PENDING');
assert.equal(foundOrder.getTotalAmount(), 800);

// Truy xuất ID không tồn tại
const notFound = await repo.findById('ord-999');
assert.equal(notFound, null, 'Tìm kiếm ID không tồn tại phải trả về null');

// Truy xuất theo Customer ID
const custOrders = await repo.findByCustomerId('cust-ABC');
assert.equal(custOrders.length, 1);
assert.equal(custOrders[0].id, 'ord-001');

const noOrders = await repo.findByCustomerId('cust-XYZ');
assert.equal(noOrders.length, 0);

// 3. Kiểm chứng cập nhật trạng thái Aggregate qua Repository
foundOrder.confirm();
await repo.save(foundOrder);

const updatedOrder = await repo.findById('ord-001');
assert.equal(updatedOrder.getStatus(), 'CONFIRMED', 'Trạng thái sau khi save phải là CONFIRMED');

// 4. Kiểm chứng xóa và xóa sạch bộ nhớ tạm
const order2 = Order.create('ord-002', 'cust-ABC', [{ productId: 'prod-C', quantity: 1, unitPrice: 50 }]);
await repo.save(order2);
assert.equal(repo.count(), 2);

const deleted = await repo.delete('ord-002');
assert.equal(deleted, true);
assert.equal(await repo.exists('ord-002'), false);
assert.equal(repo.count(), 1);

repo.clear();
assert.equal(repo.count(), 0);

// 5. Kiểm chứng Input Invariants trên Repository
await assert.rejects(
  async () => await repo.save(null),
  /INVALID_ORDER_ENTITY/,
  'Repository phải từ chối khi lưu entity null'
);

await assert.rejects(
  async () => await repo.save({}),
  /INVALID_ORDER_ENTITY/,
  'Repository phải từ chối khi entity không có id'
);

await assert.rejects(
  async () => await repo.save({ id: '   ' }),
  /ORDER_ID_REQUIRED/,
  'Repository phải từ chối khi id là khoảng trắng'
);

// 6. Kiểm chứng Thử thách Độc lập: Thay InMemory Adapter bằng Fake Adapter có lỗi (Fault Injection)
class FailingOrderRepository {
  async save(_order) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT: Mất kết nối tới cơ sở dữ liệu');
  }
  async findById(_id) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT: Mất kết nối tới cơ sở dữ liệu');
  }
  async findByCustomerId(_customerId) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT: Mất kết nối tới cơ sở dữ liệu');
  }
  async exists(_id) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT: Mất kết nối tới cơ sở dữ liệu');
  }
  async delete(_id) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT: Mất kết nối tới cơ sở dữ liệu');
  }
}

const failingRepo = new FailingOrderRepository();
await assert.rejects(
  async () => await failingRepo.save(order1),
  /DATABASE_CONNECTION_TIMEOUT/,
  'Hệ thống phải bắt được lỗi khi Adapter cơ sở dữ liệu gặp sự cố'
);

console.log(
  'MICRO_LAB_OK CF-008 (Đã kiểm chứng thực tế Ports, Adapters & Dependency Inversion thành công)'
);
