// Micro-lab kiểm chứng thực chất cho CF-009
// Import và kiểm tra trực tiếp Use Cases, Commands, Queries và Unit of Work
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const useCasePath = path.resolve('apps/order-service/src/application/use-cases/create-order.ts');
const repoPath = path.resolve('apps/order-service/src/application/ports/order-repository.ts');

assert.ok(
  fs.existsSync(useCasePath),
  'Thất bại: apps/order-service/src/application/use-cases/create-order.ts không tồn tại!'
);
assert.ok(
  fs.existsSync(repoPath),
  'Thất bại: apps/order-service/src/application/ports/order-repository.ts không tồn tại!'
);

// Dynamic import modules
const useCaseModule = await import(`file:///${useCasePath.replace(/\\/g, '/')}`);
const repoModule = await import(`file:///${repoPath.replace(/\\/g, '/')}`);

const {
  CreateOrderUseCase,
  GetOrderByIdQueryHandler,
  InMemoryUnitOfWork,
  OrderValidationError,
  OrderAlreadyExistsError,
} = useCaseModule;

const { InMemoryOrderRepository } = repoModule;

assert.ok(CreateOrderUseCase, 'Thất bại: Chưa export class CreateOrderUseCase!');
assert.ok(GetOrderByIdQueryHandler, 'Thất bại: Chưa export class GetOrderByIdQueryHandler!');
assert.ok(InMemoryUnitOfWork, 'Thất bại: Chưa export class InMemoryUnitOfWork!');

// 1. Kiểm chứng Happy Path: Tạo đơn hàng qua Command Handler & Unit of Work
const repo = new InMemoryOrderRepository();
const uow = new InMemoryUnitOfWork();
const createOrderUseCase = new CreateOrderUseCase(repo, uow);

const command = {
  orderId: 'ord-cf009-01',
  customerId: 'cust-vip-1',
  items: [
    { productId: 'prod-A', quantity: 2, unitPrice: 100 },
    { productId: 'prod-B', quantity: 3, unitPrice: 200 },
  ],
};

const result = await createOrderUseCase.execute(command);
assert.equal(result.orderId, 'ord-cf009-01', 'Order ID phải chính xác');
assert.equal(result.customerId, 'cust-vip-1');
assert.equal(result.status, 'PENDING', 'Đơn hàng mới tạo phải ở trạng thái PENDING');
assert.equal(result.totalAmount, 800, 'Tổng tiền phải tính chính xác: 2*100 + 3*200 = 800');
assert.equal(result.itemCount, 2, 'Số lượng mặt hàng phải là 2');
assert.equal(uow.commitCount, 1, 'Unit of Work phải commit thành công 1 lần');
assert.equal(uow.rollbackCount, 0, 'Unit of Work không được rollback');
assert.equal(repo.count(), 1, 'Repository phải lưu trữ 1 đơn hàng');

// 2. Kiểm chứng CQRS Query Handler: Đọc dữ liệu đơn hàng (Side-effect free)
const queryHandler = new GetOrderByIdQueryHandler(repo);
const orderView = await queryHandler.execute({ orderId: 'ord-cf009-01' });

assert.ok(orderView, 'Phải tìm thấy đơn hàng qua Query Handler');
assert.equal(orderView.id, 'ord-cf009-01');
assert.equal(orderView.customerId, 'cust-vip-1');
assert.equal(orderView.status, 'PENDING');
assert.equal(orderView.totalAmount, 800);
assert.equal(orderView.items.length, 2);
assert.equal(orderView.items[0].subtotal, 200);
assert.equal(orderView.items[1].subtotal, 600);

// Kiểm chứng tính chất Side-effect free của Query: Gọi 3 lần liên tiếp, trạng thái không đổi
for (let i = 0; i < 3; i++) {
  const repeatedView = await queryHandler.execute({ orderId: 'ord-cf009-01' });
  assert.equal(repeatedView.id, 'ord-cf009-01');
}
assert.equal(repo.count(), 1, 'Query tuyệt đối không được làm thay đổi số lượng bản ghi trong DB');
assert.equal(uow.commitCount, 1, 'Query không được kích hoạt transaction commit');

// Query đơn không tồn tại -> trả về null
const nonExistent = await queryHandler.execute({ orderId: 'ord-not-found' });
assert.equal(nonExistent, null, 'Truy vấn đơn không tồn tại phải trả về null');

// 3. Kiểm chứng Transaction Boundary & Rollback khi xảy ra lỗi trong Unit of Work
class FailingSaveOrderRepository extends InMemoryOrderRepository {
  async save(_order) {
    throw new Error('DATABASE_DISK_FULL: Không thể ghi dữ liệu xuống đĩa');
  }
}

const failingRepo = new FailingSaveOrderRepository();
const failingUow = new InMemoryUnitOfWork();
const failingUseCase = new CreateOrderUseCase(failingRepo, failingUow);

await assert.rejects(
  async () =>
    await failingUseCase.execute({
      orderId: 'ord-fail',
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
    }),
  /DATABASE_DISK_FULL/
);

assert.equal(failingUow.commitCount, 0, 'Không được commit khi có lỗi');
assert.equal(failingUow.rollbackCount, 1, 'Unit of Work bắt buộc phải rollback khi gặp lỗi');

// 4. Kiểm chứng Business Errors rõ ràng (Validation & Business Invariants)
// Lỗi thiếu customerId
await assert.rejects(
  async () =>
    await createOrderUseCase.execute({
      customerId: '',
      items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
    }),
  OrderValidationError
);

// Lỗi danh sách items rỗng
await assert.rejects(
  async () =>
    await createOrderUseCase.execute({
      customerId: 'cust-1',
      items: [],
    }),
  OrderValidationError
);

// Lỗi trùng lặp mã đơn (Duplicate Order ID)
await assert.rejects(
  async () =>
    await createOrderUseCase.execute({
      orderId: 'ord-cf009-01', // ID đã tồn tại ở bước 1
      customerId: 'cust-another',
      items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
    }),
  OrderAlreadyExistsError
);

// Lỗi Invariant từ Domain (Quantity âm)
await assert.rejects(
  async () =>
    await createOrderUseCase.execute({
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: -5, unitPrice: 100 }],
    }),
  /INVALID_QUANTITY|QUANTITY_MUST_BE_POSITIVE/
);

console.log(
  'MICRO_LAB_OK CF-009 (Đã kiểm chứng thực tế Use Cases, Commands, Queries & Unit of Work thành công)'
);
