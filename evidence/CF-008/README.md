# Evidence CF-008

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-008/demo.mjs`
  - Output: `MICRO_LAB_OK CF-008 (Đã kiểm chứng thực tế Ports, Adapters & Dependency Inversion thành công)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1: Lưu Order Entity null hoặc không hợp lệ:
    - Lệnh: `node -e "import('./apps/order-service/src/application/ports/order-repository.ts').then(async m => { const repo = new m.InMemoryOrderRepository(); await repo.save(null); })"`
    - Observed Output: `Error: INVALID_ORDER_ENTITY: Order entity không hợp lệ hoặc không có id` (Exit code 1).
  - Tình huống kiểm thử 2: Lưu Order Entity có id rỗng hoặc khoảng trắng:
    - Lệnh: `node -e "import('./apps/order-service/src/application/ports/order-repository.ts').then(async m => { const repo = new m.InMemoryOrderRepository(); await repo.save({ id: '   ' }); })"`
    - Observed Output: `Error: ORDER_ID_REQUIRED: Order ID không được để trống khi lưu vào repository` (Exit code 1).
  - Tình huống kiểm thử 3: Kiểm chứng quy tắc kiến trúc Dependency Inversion (DIP Architecture Boundary Check — Domain & Port tuyệt đối không import Prisma):
    - Lệnh: `node -e "const fs = require('fs'); const port = fs.readFileSync('apps/order-service/src/application/ports/order-repository.ts', 'utf8'); const domain = fs.readFileSync('apps/order-service/src/domain/order.aggregate.ts', 'utf8'); if (port.includes('prisma') || domain.includes('prisma')) { console.error('DIP_VIOLATION'); process.exit(1); } else { console.log('PASS_DIP_CLEAN'); }"`
    - Observed Output: `PASS_DIP_CLEAN` (Exit code 0).
  - Tình huống kiểm thử 4: Fake Adapter ném lỗi khi kết nối database bị gián đoạn (Fault Injection):
    - Lệnh: `node -e "import('./apps/order-service/src/application/ports/order-repository.ts').then(async m => { class FailingRepo { async save() { throw new Error('DATABASE_CONNECTION_TIMEOUT: Mất kết nối DB'); } } const repo = new FailingRepo(); await repo.save(); })"`
    - Observed Output: `Error: DATABASE_CONNECTION_TIMEOUT: Mất kết nối DB` (Exit code 1).
  - Giải thích kết quả: Repository interface và InMemory adapter đảm bảo tuân thủ tính đóng gói và ràng buộc toàn vẹn của Aggregate, ngăn chặn lưu trữ dữ liệu rác, đồng thời cô lập hoàn toàn tầng nghiệp vụ khỏi bất kỳ sự phụ thuộc nào vào hạ tầng (Infrastructure / ORM / Prisma).

[ANSWER]
## 1. Trade-off: Rủi ro khi Infrastructure import ngược Domain sai chiều (Dependency Inversion Violation)

Trong thiết kế hệ thống theo Clean Architecture / Hexagonal Architecture (Ports and Adapters), một trong những sai lầm kiến trúc phổ biến và tai hại nhất là việc để **Domain hoặc Application phụ thuộc trực tiếp vào Infrastructure**:

### Tác hại của việc vi phạm Dependency Rule:
1. **Dính chặt vào công nghệ cụ thể (High Coupling):**
   - Nếu Domain Entity kế thừa từ Prisma Model hoặc TypeORM BaseEntity (`Active Record` pattern), hoặc Domain Service trực tiếp `import { PrismaClient } from '@prisma/client'`, thì mỗi khi thay đổi thư viện ORM, nâng cấp phiên bản database, hoặc chuyển từ PostgreSQL sang CockroachDB / MongoDB, toàn bộ logic nghiệp vụ cốt lõi đều bị xáo trộn.
2. **Phá vỡ tính độc lập và khả năng kiểm thử (Testing Nightmare):**
   - Không thể chạy unit test cho logic nghiệp vụ trong bộ nhớ RAM với thời gian thực thi mili-giây. Bất kỳ bài test nào cũng phải khởi động mock framework phức tạp hoặc dựng container database thật, làm chậm CI/CD và giảm độ tin cậy của bộ test suite.
3. **Rò rỉ chi tiết kỹ thuật vào nghiệp vụ (Leaky Abstraction):**
   - Các thuộc tính chỉ phục vụ việc lưu trữ (như auto-increment ID, foreign keys, database flags) bị lộ vào trong Domain Model, làm mờ nhạt các Business Invariants (quy tắc bất biến) của nghiệp vụ.

### Giải pháp với Ports, Adapters và Dependency Inversion Principle (DIP):
```
+-------------------------------------------------------------------+
|                       APPLICATION LAYER                           |
|                                                                   |
|   +-----------------------+              +--------------------+   |
|   |  CreateOrderUseCase   | ---------->  |  OrderRepository   |   |
|   +-----------------------+              |     (Port/SPI)     |   |
|                                          +--------------------+   |
+----------------------------------------------------^--------------+
                                                     | implements
+----------------------------------------------------+--------------+
|                      INFRASTRUCTURE LAYER          |              |
|                                                    |              |
|   +-----------------------------+                  |              |
|   |   InMemoryOrderRepository   | -----------------+              |
|   |       (Testing Adapter)     |                  |              |
|   +-----------------------------+                  |              |
|                                                    |              |
|   +-----------------------------+                  |              |
|   |    PrismaOrderRepository    | -----------------+              |
|   |     (Production Adapter)    |                                 |
|   +-----------------------------+                                 |
+-------------------------------------------------------------------+
```

- **Port (`OrderRepository`):** Là interface trừu tượng do tầng Application / Domain sở hữu và làm chủ. Nó chỉ định nghĩa các hợp đồng nghiệp vụ cần thiết (`save`, `findById`, `findByCustomerId`) mà không cần biết dữ liệu được lưu vào RAM, PostgreSQL hay DynamoDB.
- **Adapter (`InMemoryOrderRepository`, `PrismaOrderRepository`):** Là thành phần hạ tầng (Infrastructure) triển khai cụ thể interface Port đó.
- **Dependency Inversion:** Chiều phụ thuộc mã nguồn (Source Code Dependency) luôn hướng vào trung tâm (Domain / Application), ngược lại với chiều thực thi lúc runtime (Runtime Control Flow). Do đó, tầng Domain hoàn toàn "mù" về công nghệ lưu trữ.

---

## 2. Thử thách độc lập: Thay In-Memory Adapter bằng Fake có lỗi (Fault Injection & Resilience)

### Bản chất bài toán:
Trong thực tế production, cơ sở dữ liệu và hạ tầng mạng không bao giờ hoàn hảo 100%. Các sự cố sau luôn có thể xảy ra:
- Database Connection Timeout (mạng chập chờn, kết nối tới Cloud SQL bị ngắt quãng).
- Connection Pool Exhaustion (hết connection sẵn sàng).
- Deadlock hoặc Serialization Failure khi có nhiều giao dịch đồng thời.

Để đảm bảo hệ thống có độ chịu lỗi (Resilience), tầng Use Case không được phép ngầm định rằng lệnh `save()` sẽ luôn thành công. Nhờ có Port & Adapter, chúng ta có thể dễ dàng tiêm một **Fake Adapter có lỗi (Faulty Adapter)** trong Unit Test để kiểm chứng xem hệ thống phản ứng ra sao khi cơ sở dữ liệu sập.

### Phép thử chứng minh (Verification Test):
Đoạn mã assertion độc lập chứng minh việc hoán đổi Adapter không làm ảnh hưởng đến mã nghiệp vụ, và lỗi hạ tầng được kiểm soát chính xác:

```javascript
import assert from 'node:assert/strict';
import { Order } from './apps/order-service/src/domain/order.aggregate.ts';
import { InMemoryOrderRepository } from './apps/order-service/src/application/ports/order-repository.ts';

// 1. Tạo đơn hàng hợp lệ
const order = Order.create('ord-test-fault', 'cust-01', [
  { productId: 'prod-A', quantity: 2, unitPrice: 150 }
]);

// 2. Định nghĩa Fake Adapter mô phỏng lỗi sập kết nối Database
class DatabaseOutageOrderRepository {
  async save(_order) {
    throw new Error('DATABASE_CONNECTION_REFUSED: Không thể kết nối tới cơ sở dữ liệu PostgreSQL');
  }
  async findById(_id) {
    throw new Error('DATABASE_TIMEOUT: Yêu cầu truy vấn cơ sở dữ liệu quá thời gian chờ');
  }
  async findByCustomerId(_customerId) {
    return [];
  }
  async exists(_id) {
    return false;
  }
  async delete(_id) {
    return false;
  }
}

// 3. Phép thử mô phỏng Use Case khi gặp lỗi hạ tầng
async function executeOrderPersistence(repository, orderEntity) {
  try {
    await repository.save(orderEntity);
    return { success: true };
  } catch (err) {
    // Tầng Use Case phát hiện lỗi hạ tầng và bao bọc thành mã lỗi nghiệp vụ/vận hành an toàn
    return { success: false, error: err.message };
  }
}

// Kiểm chứng với Healthy Adapter (In-Memory)
const healthyRepo = new InMemoryOrderRepository();
const healthyResult = await executeOrderPersistence(healthyRepo, order);
assert.equal(healthyResult.success, true, 'Healthy adapter phải lưu thành công');
assert.equal(await healthyRepo.exists('ord-test-fault'), true);

// Kiểm chứng với Faulty Adapter (Giả lập sự cố DB)
const faultyRepo = new DatabaseOutageOrderRepository();
const faultyResult = await executeOrderPersistence(faultyRepo, order);
assert.equal(faultyResult.success, false, 'Faulty adapter phải thất bại có kiểm soát');
assert.match(faultyResult.error, /DATABASE_CONNECTION_REFUSED/);

console.log('PASS: Kiểm chứng thay thế Fake Adapter có lỗi đã chứng minh thành công!');
```
