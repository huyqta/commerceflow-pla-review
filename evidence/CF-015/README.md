# Evidence CF-015

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 7234928dc0b18c47716b26b1cc8d0cd1545ce1f5
- Commands / exit codes:
  - Command: `node labs/CF-015/demo.mjs`
  - Output: `MICRO_LAB_OK CF-015`
  - Exit code: `0`
  - Automated Test Suite (Order Lifecycle & State Machine): `node --test tests/order/order-lifecycle.test.ts`
  - Output: `ℹ tests 7 | ℹ suites 5 | ℹ pass 7 | ℹ fail 0 | ℹ duration_ms 174.6912`
  - Exit code: `0`
  - Inventory Reservation & Concurrency Tests: `node --test tests/inventory/inventory-reservation.test.ts`
  - Output: `ℹ tests 10 | ℹ suites 5 | ℹ pass 10 | ℹ fail 0 | ℹ duration_ms 167.1473`
  - Exit code: `0`
  - Catalog REST API Tests: `node --test tests/api/catalog-api.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 4 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 151.8335`
  - Exit code: `0`
  - Database Schema & ACID Tests: `node --test tests/database/order-schema.test.ts`
  - Output: `ℹ tests 12 | ℹ suites 3 | ℹ pass 12 | ℹ fail 0 | ℹ duration_ms 155.1829`
  - Exit code: `0`
  - Architecture Boundary Tests: `node --test tests/architecture/order-boundary.test.ts`
  - Output: `ℹ tests 13 | ℹ suites 3 | ℹ pass 13 | ℹ fail 0 | ℹ duration_ms 203.7377`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1 (Thử thách độc lập): Chuyển trạng thái bất hợp lệ - Cố tình hủy đơn hàng đã CONFIRMED (`CONFIRMED -> CANCELLED`):
    - Lệnh: `node -e "import('./apps/order-service/src/domain/order.aggregate.ts').then(m => { const o = m.Order.create('ord-c1', 'c1', [{ productId: 'p1', quantity: 1, unitPrice: 10 }]); o.confirm(); o.cancel('Khách đổi ý sau khi đã duyệt'); })"`
    - Observed Output: `Error: INVALID_TRANSITION: CANNOT_CANCEL_CONFIRMED_ORDER` (Exit code 1).
  - Tình huống kiểm thử 2: Chuyển trạng thái bất hợp lệ - Cố tình xác nhận đơn hàng đã CANCELLED (`CANCELLED -> CONFIRMED`):
    - Lệnh: `node -e "import('./apps/order-service/src/domain/order.aggregate.ts').then(m => { const o = m.Order.create('ord-c2', 'c1', [{ productId: 'p1', quantity: 1, unitPrice: 10 }]); o.cancel('Đổi ý'); o.confirm(); })"`
    - Observed Output: `Error: INVALID_TRANSITION: CANNOT_CONFIRM_CANCELLED_ORDER (Current: CANCELLED)` (Exit code 1).
  - Tình huống kiểm thử 3: Sản phẩm trong đơn hàng không tồn tại trong danh mục Catalog (`PRODUCT_NOT_FOUND`):
    - Lệnh: `node -e "import('./apps/order-service/src/application/place-order.ts').then(async m => { const uc = new m.PlaceOrderUseCase(new (await import('./apps/order-service/src/application/ports/order-repository.ts')).InMemoryOrderRepository(), new m.InMemoryCatalogPortAdapter([]), { reserveStock: async () => ({ success: true }) }, new m.PaymentSimulatorPortAdapter()); await uc.execute({ customerId: 'c1', items: [{ productId: 'UNKNOWN-PROD', quantity: 1 }] }); })"`
    - Observed Output: `OrderLifecycleError: PRODUCT_NOT_FOUND: Sản phẩm 'UNKNOWN-PROD' không tồn tại trong danh mục catalog { code: 'CATALOG_ERROR' }` (Exit code 1).
  - Tình huống kiểm thử 4: Kiểm tra tính bất biến của bảng State Machine Transitions (`canTransitionOrder`):
    - Lệnh: `node -e "import('./apps/order-service/src/application/place-order.ts').then(m => { if (!m.canTransitionOrder('CONFIRMED', 'CANCELLED')) { console.log('PASS_CONFIRMED_CANNOT_BE_CANCELLED'); } else { process.exit(1); } })"`
    - Observed Output: `PASS_CONFIRMED_CANNOT_BE_CANCELLED` (Exit code 0).
  - Giải thích kết quả: Bảng chuyển đổi trạng thái (State Machine Transitions) bảo vệ toàn vẹn chu trình đơn hàng, ngăn ngừa mọi thao tác chuyển trạng thái trái phép; việc điều phối qua Use Case đảm bảo tính cô lập và đúng đắn của nghiệp vụ.

[ANSWER]
## 1. Trade-off: Rủi ro khi để Controller nắm nghiệp vụ điều phối (The Fat Controller Anti-pattern)

Trong kiến trúc phần mềm, việc lập trình viên để Controller trực tiếp thực hiện các nghiệp vụ phức tạp (gọi database, điều phối kiểm tra kho, kích hoạt thanh toán, xử lý bồi hoàn Saga) là một Anti-pattern nghiêm trọng được gọi là **Smart/Fat Controller**:

### Các tác hại nghiêm trọng:
1. **Vi phạm nguyên tắc Single Responsibility Principle (SRP):**
   - Controller thuộc tầng Presentation, trách nhiệm duy nhất của nó là nhận HTTP request, xác thực header/token, serialize/deserialize JSON và trả về HTTP status code phù hợp.
   - Khi Controller nhồi nhét logic điều phối, nó trở thành một "God Object" vừa làm giao diện, vừa làm nghiệp vụ, vừa làm hạ tầng.
2. **Khóa chặt nghiệp vụ vào giao thức HTTP (Protocol Coupling):**
   - Nếu ngày mai hệ thống muốn tiếp nhận đơn hàng từ một nguồn khác (ví dụ: gRPC internal call, Cloud Pub/Sub message consumer, hoặc CLI batch import), ta buộc phải duplicate (sao chép lặp lại) toàn bộ logic đặt hàng trong Controller đó sang worker khác.
3. **Cản trở Unit Testing và kiểm thử tự động:**
   - Để kiểm thử nghiệp vụ đặt hàng trong Fat Controller, ta buộc phải mock toàn bộ HTTP request, response, headers, cookies, query params rất cồng kềnh.
   - Trong khi với Use Case thuần túy (`PlaceOrderUseCase`), ta chỉ cần truyền command object và mock các Interface Ports (Catalog, Inventory, Payment) là có thể test 100% kịch bản trong vài mili-giây.

### Giải pháp thiết kế trong CommerceFlow:
- **Thin Controller (`PlaceOrderController`):** Chỉ nhận HTTP body, validate định dạng sơ bộ, ủy quyền xử lý hoàn toàn cho `PlaceOrderUseCase`, sau đó ánh xạ kết quả nghiệp vụ thành HTTP status code (`201` cho CONFIRMED, `422` cho REJECTED, `402` cho CANCELLED).
- **Application Orchestrator (`PlaceOrderUseCase`):** Điều phối các Bounded Context thông qua Interfaces / Ports (`CatalogQueryPort`, `InventoryReservationPort`, `PaymentPort`).

---

## 2. Thử thách độc lập: Kiểm tra State Machine Cancel sau Confirm

### Bản chất nghiệp vụ:
Trong thương mại điện tử, trạng thái `CONFIRMED` đại diện cho một thỏa thuận kinh tế đã được ràng buộc hợp pháp:
- Hàng hóa trong kho đã được giữ chính thức (`RESERVED` / đóng gói).
- Tiền của khách hàng đã được trừ thành công qua cổng thanh toán (`Payment Captured`).
- Hóa đơn tài chính đã được phát hành.

### Bất biến trạng thái (State Invariant):
- Khi đơn hàng đã chuyển sang `CONFIRMED`, **TUYỆT ĐỐI KHÔNG ĐƯỢC phép trực tiếp gọi hàm `cancel()`** để chuyển trạng thái về `CANCELLED`.
- Nếu khách hàng muốn đổi ý sau khi đơn đã `CONFIRMED`, hệ thống phải chuyển sang một quy trình nghiệp vụ hoàn toàn khác: **Quy trình Trả hàng & Hoàn tiền (Returns & Refunds Workflow)** với sự xét duyệt của bộ phận Chăm sóc khách hàng / Quản trị viên và phát sinh giao dịch bồi hoàn ngân hàng độc lập.

### Phép thử chứng minh (Verification Test Proof):
Đoạn mã assertion độc lập chứng minh Order Aggregate và State Machine Validator từ chối lệnh cancel sau khi đã confirm:

```javascript
import assert from 'node:assert/strict';
import { Order } from './apps/order-service/src/domain/order.aggregate.ts';
import { canTransitionOrder } from './apps/order-service/src/application/place-order.ts';

// -------------------------------------------------------------
// 1. KIỂM CHỨNG BẢNG CHUYỂN TRẠNG THÁI (STATE MACHINE)
// -------------------------------------------------------------
const isAllowed = canTransitionOrder('CONFIRMED', 'CANCELLED');
assert.equal(isAllowed, false, 'State machine phải từ chối chuyển từ CONFIRMED sang CANCELLED');

// -------------------------------------------------------------
// 2. PHÉP THỬ THỰC THỂ AGGREGATE
// -------------------------------------------------------------
const order = Order.create('ORD-TEST-01', 'CUST-01', [
  { productId: 'PROD-A', quantity: 1, unitPrice: 100 }
]);

// Bước 1: Xác nhận đơn hàng thành công (PENDING -> CONFIRMED)
order.confirm();
assert.equal(order.getStatus(), 'CONFIRMED');

// Bước 2: Cố tình gọi cancel() trên đơn hàng đã CONFIRMED -> BẮT BUỘC NÉM LỖI!
assert.throws(
  () => {
    order.cancel('Khách đòi hủy sau khi đã xác nhận');
  },
  (err) => {
    assert.match(err.message, /INVALID_TRANSITION: CANNOT_CANCEL_CONFIRMED_ORDER/);
    return true;
  }
);

// Khẳng định trạng thái đơn hàng vẫn được bảo toàn nguyên vẹn
assert.equal(order.getStatus(), 'CONFIRMED', 'Trạng thái đơn hàng phải giữ nguyên CONFIRMED');

console.log('PASS: Phép thử State Machine ngăn cấm Cancel sau Confirm đã được chứng minh thành công!');
```
