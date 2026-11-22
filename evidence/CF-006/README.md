# Evidence CF-006

Status: verified

- Environment: Node.js v24.12.0, Windows 11 (PowerShell/pwsh), Git 2.52.0
- Revision SHA: 9ccda58f8d16a9c15905f142ee7b7fee8d72d5bc
- Commands / exit codes:
  - Command: `node labs/CF-006/demo.mjs`
  - Output: `MICRO_LAB_OK CF-006 (Đã kiểm chứng thực tế Order Aggregate & Business Invariants thành công)`
  - Exit code: `0`
- Negative case:
  - Tình huống kiểm thử 1: Khởi tạo Quantity với giá trị 0 hoặc số âm:
    - Lệnh: `node -e "import('./apps/order-service/src/domain/order.aggregate.ts').then(m => new m.Quantity(0))"`
    - Observed Output: `Error: INVALID_QUANTITY: QUANTITY_MUST_BE_POSITIVE` (Exit code 1).
  - Tình huống kiểm thử 2: Chuyển đổi trạng thái bất hợp lệ (Confirm đơn đã bị Cancel):
    - Lệnh: `node -e "import('./apps/order-service/src/domain/order.aggregate.ts').then(m => { const o = m.Order.create('ord-1', 'c1', [{ productId: 'p1', quantity: 1, unitPrice: 10 }]); o.cancel(); o.confirm(); })"`
    - Observed Output: `Error: INVALID_TRANSITION: CANNOT_CONFIRM_CANCELLED_ORDER` (Exit code 1).
  - Giải thích: Validator kiểm tra thực tế các Business Invariants của Entity, Value Object và Aggregate, ngăn ngừa việc vi phạm luật nghiệp vụ.

[ANSWER]
## 1. Trade-off: Thực thể chỉ là ORM Model (Anemic Domain Model vs Rich Domain Model)

Trong phát triển phần mềm doanh nghiệp, sự đánh đổi lớn nhất giữa Active Record/ORM Model thuần túy và Domain-Driven Design (DDD) Rich Domain Model thể hiện ở việc bảo vệ quy tắc nghiệp vụ:

- **Mô hình Thiếu máu (Anemic Domain Model - Entity chỉ là ORM Model):**
  - Thực thể chỉ chứa các thuộc tính public getters/setters tương ứng với các cột trong bảng cơ sở dữ liệu (ví dụ: Prisma schema hoặc TypeORM entity).
  - Toàn bộ logic kiểm tra và xử lý trạng thái bị rò rỉ ra các Service tầng ngoài (Application/Service layer) hoặc Controller:
    ```typescript
    // Ví dụ Anti-pattern: Bất kỳ ai cũng có thể gán trạng thái sai mà không có kiểm soát
    order.status = 'CONFIRMED'; 
    await orderRepository.save(order);
    ```
  - **Hậu quả:** Quy tắc bất biến (Business Invariants) bị phân tán ở nhiều nơi. Một lập trình viên mới có thể quên kiểm tra điều kiện "đơn đã hủy thì không được xác nhận", dẫn đến dữ liệu rác (corrupted state) đi thẳng vào cơ sở dữ liệu.
- **Mô hình Giàu nghiệp vụ (Rich Domain Model - DDD Aggregate):**
  - Trạng thái nội tại (`status`, `items`) được đóng gói hoàn toàn (`private`).
  - Điểm thay đổi duy nhất là thông qua các phương thức hành vi mang ý nghĩa nghiệp vụ (`order.confirm()`, `order.cancel(reason)`).
  - Aggregate Root chịu trách nhiệm duy nhất trong việc bảo vệ tính toàn vẹn của transaction: Mọi trạng thái không hợp lệ đều bị từ chối ngay trong bộ nhớ trước khi chạm tới cơ sở dữ liệu.
  - **Đánh đổi (Trade-off):** Cần thêm tầng Mapper để chuyển đổi giữa Domain Entity và ORM Persistence Model (Data Mapper Pattern), đòi hỏi viết thêm mã nguồn boilerplate nhưng bù lại mang lại sự an toàn và khả năng kiểm thử độc lập tuyệt đối (Zero Framework Dependencies).

---

## 2. Thử thách độc lập: Thêm invariant không cho đặt quantity bằng 0

### Bản chất bài toán:
Trong thương mại điện tử, việc cho phép đặt số lượng hàng bằng 0 hoặc số âm (`quantity <= 0`) gây ra các lỗ hổng nghiêm trọng:
1. Tạo ra các đơn hàng "ma" (phantom orders) không có hàng nhưng vẫn giữ kết nối hoặc làm lệch doanh thu.
2. Tấn công trừ kho đảo chiều (khi số lượng âm biến phép trừ thành phép cộng tồn kho trái phép).

### Giải pháp thiết kế:
Đóng gói quy tắc này vào một **Value Object bất biến: `Quantity`**:
```typescript
export class Quantity {
  public readonly value: number;

  constructor(value: number) {
    if (!Number.isInteger(value)) {
      throw new Error('INVALID_QUANTITY: QUANTITY_MUST_BE_INTEGER');
    }
    if (value <= 0) {
      throw new Error('INVALID_QUANTITY: QUANTITY_MUST_BE_POSITIVE');
    }
    this.value = value;
  }
}
```

### Phép thử chứng minh (Verification Test):
- Đoạn mã assertion độc lập chứng minh quy tắc invariant chặn đứng giá trị bằng 0 và giá trị âm:
  ```javascript
  import assert from 'node:assert/strict';
  import { Quantity, Order } from './apps/order-service/src/domain/order.aggregate.ts';

  // 1. Phép thử Quantity bằng 0
  assert.throws(
    () => new Quantity(0),
    /QUANTITY_MUST_BE_POSITIVE/,
    'Lỗi Invariant: Hệ thống không được phép cho khởi tạo Quantity = 0!'
  );

  // 2. Phép thử Quantity số âm
  assert.throws(
    () => new Quantity(-5),
    /QUANTITY_MUST_BE_POSITIVE/,
    'Lỗi Invariant: Hệ thống không được phép cho khởi tạo Quantity âm!'
  );

  // 3. Phép thử tạo đơn hàng chứa item có số lượng = 0
  assert.throws(
    () => Order.create('ord-test', 'cust-test', [
      { productId: 'prod-A', quantity: 0, unitPrice: 100 }
    ]),
    /QUANTITY_MUST_BE_POSITIVE/,
    'Lỗi Invariant: Order không thể tạo với mặt hàng có số lượng bằng 0!'
  );

  console.log('PASS: Phép thử Invariant Quantity > 0 đã chứng minh thành công!');
  ```
