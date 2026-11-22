# Evidence CF-009

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-009/demo.mjs`
  - Output: `MICRO_LAB_OK CF-009 (Đã kiểm chứng thực tế Use Cases, Commands, Queries & Unit of Work thành công)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1: Tạo đơn hàng thiếu mã khách hàng (`CUSTOMER_ID_REQUIRED`):
    - Lệnh: `node -e "import('./apps/order-service/src/application/use-cases/create-order.ts').then(async m => { const r = await import('./apps/order-service/src/application/ports/order-repository.ts'); const uc = new m.CreateOrderUseCase(new r.InMemoryOrderRepository()); await uc.execute({ customerId: '', items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] }); })"`
    - Observed Output: `OrderValidationError: CUSTOMER_ID_REQUIRED: Mã khách hàng không được để trống` (Exit code 1).
  - Tình huống kiểm thử 2: Tạo đơn hàng với danh sách mặt hàng rỗng (`EMPTY_ORDER_ITEMS`):
    - Lệnh: `node -e "import('./apps/order-service/src/application/use-cases/create-order.ts').then(async m => { const r = await import('./apps/order-service/src/application/ports/order-repository.ts'); const uc = new m.CreateOrderUseCase(new r.InMemoryOrderRepository()); await uc.execute({ customerId: 'c1', items: [] }); })"`
    - Observed Output: `OrderValidationError: EMPTY_ORDER_ITEMS: Đơn hàng phải có ít nhất một sản phẩm` (Exit code 1).
  - Tình huống kiểm thử 3: Trùng lặp mã đơn hàng khi gửi trùng command (`ORDER_ALREADY_EXISTS`):
    - Lệnh: `node -e "import('./apps/order-service/src/application/use-cases/create-order.ts').then(async m => { const r = await import('./apps/order-service/src/application/ports/order-repository.ts'); const repo = new r.InMemoryOrderRepository(); const uc = new m.CreateOrderUseCase(repo); await uc.execute({ orderId: 'ord-dup', customerId: 'c1', items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] }); await uc.execute({ orderId: 'ord-dup', customerId: 'c1', items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] }); })"`
    - Observed Output: `OrderAlreadyExistsError: ORDER_ALREADY_EXISTS: Đơn hàng với ID 'ord-dup' đã tồn tại` (Exit code 1).
  - Tình huống kiểm thử 4: Tự động Rollback trong Unit of Work khi giao dịch cơ sở dữ liệu gặp lỗi:
    - Lệnh: `node -e "import('./apps/order-service/src/application/use-cases/create-order.ts').then(async m => { class FailRepo { async exists() { return false; } async save() { throw new Error('DB_FAIL'); } } const uow = new m.InMemoryUnitOfWork(); const uc = new m.CreateOrderUseCase(new FailRepo(), uow); try { await uc.execute({ customerId: 'c1', items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] }); } catch (e) { if (uow.rollbackCount === 1) console.log('PASS_UOW_ROLLBACK'); else process.exit(1); } })"`
    - Observed Output: `PASS_UOW_ROLLBACK` (Exit code 0).
  - Giải thích kết quả: Hệ thống kiểm soát tính toàn vẹn thông qua Unit of Work, ngăn chặn dữ liệu rác, bẫy các lỗi vi phạm điều kiện biên thành các `ApplicationError` rõ ràng (`OrderValidationError`, `OrderAlreadyExistsError`) thay vì ném lỗi generic 500 không xác định.

[ANSWER]
## 1. Trade-off: Rủi ro khi bọc External HTTP Call trong SQL Transaction (Network IO inside Database Transaction Anti-pattern)

Trong kiến trúc dịch vụ phân tán, một trong những sai lầm thiết kế phổ biến và gây tê liệt hệ thống nhiều nhất là **thực hiện cuộc gọi mạng ngoại vi (HTTP/REST, gRPC) bên trong phạm vi giao dịch cơ sở dữ liệu (SQL Transaction)**:

### Kịch bản lỗi điển hình:
```typescript
// ANTI-PATTERN NGUY HIỂM:
await prisma.$transaction(async (tx) => {
  // 1. Tạo đơn hàng trong DB
  const order = await tx.order.create({ data: { ... } });

  // 2. Gọi HTTP sang dịch vụ thanh toán hoặc kho bên ngoài (Nguy hiểm!)
  const paymentResponse = await httpClient.post('https://payment-service/charge', {
    amount: order.total,
  });

  // 3. Cập nhật trạng thái đơn
  await tx.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
});
```

### Các hậu quả nghiêm trọng:
1. **Cạn kiệt Connection Pool (Database Connection Starvation):**
   - Các truy vấn SQL thuần túy thường hoàn thành trong $1 \sim 5\text{ ms}$.
   - Nhưng cuộc gọi HTTP qua mạng Internet/LAN thường mất $200 \sim 3000\text{ ms}$, thậm chí lên tới $30\text{ giây}$ nếu bên nhận bị nghẽn mạng hoặc quá tải.
   - Việc giữ connection cơ sở dữ liệu nhàn rỗi chỉ để đợi phản hồi mạng sẽ khiến toàn bộ Connection Pool (thường từ 20–50 connections) bị chiếm dụng hết sạch trong chớp mắt. Hệ thống rơi vào trạng thái tê liệt (`Connection timeout: Can't reach database server`).
2. **Khóa dữ liệu kéo dài và Gây Deadlock (Long-holding Locks & Concurrency Contention):**
   - Trong lúc đợi HTTP trả lời, các khóa hàng (`SELECT ... FOR UPDATE` hoặc Row-Exclusive locks) bị giữ liên tục, làm các giao dịch khác cố gắng cập nhật bảng `orders` hoặc bảng tồn kho `inventory` đều bị block, dẫn đến xếp hàng dài và lỗi Deadlock hàng loạt.
3. **Ảo tưởng về tính nguyên tử (Không thể Rollback Network IO):**
   - Giả sử cổng thanh toán đã trừ tiền khách thành công (bước 2), nhưng sau đó cơ sở dữ liệu gặp sự cố ở bước 3 hoặc tiến trình bị sập nguồn (`SIGKILL`). SQL Transaction tự động ROLLBACK!
   - **Hậu quả:** Khách hàng đã bị trừ tiền thật ở ngân hàng, nhưng trong cơ sở dữ liệu đơn hàng lại không hề tồn tại! Không có cơ chế rollback SQL nào có thể tự động hoàn tiền đã quẹt qua HTTP.

### Giải pháp kiến trúc đúng đắn (Saga Pattern & Transactional Outbox):
- **Phân tách ranh giới giao dịch (Clear Transaction Boundary):** Giao dịch cơ sở dữ liệu chỉ bọc các thao tác nội bộ thuộc sở hữu của Aggregate đó.
- **Transactional Outbox:** Khi lưu đơn hàng, ghi nhận thêm sự kiện cần gửi (ví dụ: `OrderCreatedOutbox`) vào cùng transaction cơ sở dữ liệu.
- **Async Messaging:** Một worker nền quét outbox và phát tán thông điệp ra message broker (Pub/Sub). Giao dịch với Payment hay Inventory được phối hợp bất đồng bộ thông qua Saga Choreography/Orchestration và các lệnh bồi hoàn (Compensating Transactions) khi có lỗi.

---

## 2. Thử thách độc lập: So sánh Command với Query (CQRS Principle)

### Bản chất của CQRS (Command Query Responsibility Segregation):
CQRS là nguyên lý phân tách trách nhiệm giữa hai loại hành vi hoàn toàn khác biệt trong hệ thống phần mềm:

| Đặc điểm | Command (Mệnh lệnh / Thao tác Ghi) | Query (Truy vấn / Thao tác Đọc) |
| :--- | :--- | :--- |
| **Mục đích** | Thay đổi trạng thái nghiệp vụ (State Mutation). | Lấy dữ liệu hiển thị (State Retrieval). |
| **Tác động (Side-effect)** | Có side-effect (Tạo, sửa, xóa bản ghi, sinh Domain Events). | Tuyệt đối **không có side-effect** (Idempotent & Safe). |
| **Kiểm tra Invariant** | Thực thi business rules, validate điều kiện biên chặt chẽ. | Không kiểm tra invariant, chỉ lọc và chiếu dữ liệu (Projection). |
| **Dữ liệu trả về** | Chỉ trả về Aggregate ID, trạng thái đơn giản hoặc void. | Trả về DTO / View Model được tối ưu cho màn hình UI. |
| **Transaction** | Đòi hỏi Unit of Work / Transaction boundary. | Thường là Read-only, không cần khóa transaction. |

### Phép thử chứng minh (Verification Test):
Đoạn mã assertion độc lập chứng minh rằng Command làm biến đổi trạng thái hệ thống, trong khi Query hoàn toàn an toàn và không gây ra bất kỳ tác dụng phụ nào:

```javascript
import assert from 'node:assert/strict';
import { InMemoryOrderRepository } from './apps/order-service/src/application/ports/order-repository.ts';
import {
  CreateOrderUseCase,
  GetOrderByIdQueryHandler,
  InMemoryUnitOfWork,
} from './apps/order-service/src/application/use-cases/create-order.ts';

// Thiết lập môi trường thử nghiệm
const repo = new InMemoryOrderRepository();
const uow = new InMemoryUnitOfWork();
const createOrderCommand = new CreateOrderUseCase(repo, uow);
const getOrderQuery = new GetOrderByIdQueryHandler(repo);

// -------------------------------------------------------------
// PHÉP THỬ 1: COMMAND LÀM THAY ĐỔI TRẠNG THÁI HỆ THỐNG
// -------------------------------------------------------------
assert.equal(repo.count(), 0, 'Trước khi chạy Command, DB hoàn toàn trống');

const commandResult = await createOrderCommand.execute({
  orderId: 'ord-cqrs-test',
  customerId: 'cust-demo',
  items: [{ productId: 'p1', quantity: 2, unitPrice: 50 }],
});

assert.equal(commandResult.orderId, 'ord-cqrs-test');
assert.equal(repo.count(), 1, 'Sau khi chạy Command, DB ĐÃ THAY ĐỔI trạng thái (tăng 1 đơn hàng)!');
assert.equal(uow.commitCount, 1, 'Command kích hoạt Transaction Commit');

// -------------------------------------------------------------
// PHÉP THỬ 2: QUERY HOÀN TOÀN KHÔNG CÓ TÁC DỤNG PHỤ (SIDE-EFFECT FREE)
// -------------------------------------------------------------
const stateBeforeQuery = repo.count();
const commitBeforeQuery = uow.commitCount;

// Thực hiện gọi Query 10 lần liên tục
for (let i = 0; i < 10; i++) {
  const viewDto = await getOrderQuery.execute({ orderId: 'ord-cqrs-test' });
  assert.equal(viewDto.id, 'ord-cqrs-test');
  assert.equal(viewDto.totalAmount, 100);
}

// CHỨNG MINH INVARIANT:
assert.equal(repo.count(), stateBeforeQuery, 'Query KHÔNG ĐƯỢC PHÉP thay đổi số lượng bản ghi!');
assert.equal(uow.commitCount, commitBeforeQuery, 'Query KHÔNG ĐƯỢC PHÉP kích hoạt transaction write/commit!');

console.log('PASS: So sánh Command và Query theo nguyên lý CQRS đã được chứng minh thành công!');
```
